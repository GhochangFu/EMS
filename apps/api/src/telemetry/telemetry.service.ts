import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Pool } from "pg";

import { pointValues } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  decodePointRefParam,
  encodePointRef,
  MAX_WIDGET_WINDOW_MINUTES,
  POINT_STATS_MAX_ASSETS,
  resolveSiteTimeZone,
  type PointAggregateBucket,
  type PointAggregateFunction,
  type PointAggregateResponse,
  type PointAggregateStats,
  type PointRawRecordsResponse,
  type PointStatsByAsset,
  type PointStatsSummary,
  type TelemetryReading,
} from "@bms/shared";

import { FLEET_POOL, TENANT_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import {
  type AggregateRange,
  assertBucketCount,
  bucketSql,
  expectedBucketCount,
  fillBucketGaps,
  groupedScalarSql,
  lastBucketSql,
  levelFor,
  pointStatsWindow,
  scalarSql,
  windowBoundsFor,
} from "./point-aggregate-window";
import { bucketSeconds } from "./point-aggregates";

/**
 * `float8` reaches `node-postgres` as a JS number, but `to_jsonb` can hand back a
 * string for a value outside the JSON number range, and `NULL` must stay `null`
 * rather than becoming `0`.
 *
 * The zero case is the one that matters: a tile showing `0 kW` for a dead sensor
 * is a lie an operator will act on, where `—` is not.
 */
function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One `cur`/`prev` row as `to_jsonb` renders it. Every statistic is nullable — an empty window. */
interface ScalarRow {
  sum: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
  sample_count: number | null;
  peak_at: string | null;
}

interface BucketRow {
  t: string;
  v: number | null;
  /** Present only when the query asked for bucket statistics (`F4.297`). */
  min?: number | string | null;
  average?: number | string | null;
  max?: number | string | null;
  sample_count?: number | string | null;
}

/**
 * `F4.297` — a bucket array as the response carries it: gap-filled over
 * `[from, to)` (see `fillBucketGaps`), and with `bucketStats` each bucket also
 * carries its min, weighted mean, max and sample count. A filled gap has
 * `null` statistics and a zero count, never zeros a chart would plot.
 */
function toResponseBuckets(
  rows: readonly BucketRow[],
  from: Date,
  to: Date,
  seconds: number,
  withStats: boolean,
): PointAggregateBucket[] {
  const filled = fillBucketGaps(
    rows.map((b) => ({ t: new Date(b.t).toISOString(), v: numberOrNull(b.v) })),
    from,
    to,
    seconds,
  );
  if (!withStats) {
    return filled;
  }
  const byStart = new Map(rows.map((row) => [new Date(row.t).getTime(), row]));
  return filled.map((bucket) => {
    const row = byStart.get(new Date(bucket.t).getTime());
    return {
      ...bucket,
      min: numberOrNull(row?.min ?? null),
      average: numberOrNull(row?.average ?? null),
      max: numberOrNull(row?.max ?? null),
      sampleCount: Number(row?.sample_count ?? 0),
    };
  });
}

@Injectable()
export class TelemetryService {
  /**
   * @param fleetPool `F4.297` (ADR 0108 decision 1.9): the one `bms.*` read this
   *   service makes — the asset's location and organization zones for the
   *   `aggregate` response's `timeZone`. `bms.locations` carries Row Level
   *   Security, so the tenant pool (no `app.current_organization` set here)
   *   would see no row; the controller's `canReadAsset` has already placed the
   *   asset, which is the containment for that read.
   */
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(TENANT_POOL) private readonly pool: Pool,
    @Inject(FLEET_POOL) private readonly fleetPool: Pool,
  ) {}

  /**
   * Returns recent samples for one logical point (`assetId::pointKey`).
   * @param window e.g. `15m`, `1h`
   * @param limit the most rows read, newest first. The route leaves it at
   *   5,000; `F4.274`'s `get_recent_values` passes its own cap plus one.
   */
  async recentForPoint(pointRef: string, window?: string, limit = 5000): Promise<TelemetryReading[]> {
    let assetId: string;
    let pointKey: string;
    try {
      ({ assetId, pointKey } = decodePointRefParam(pointRef));
    } catch {
      throw new BadRequestException("Invalid point reference");
    }

    const { n, unit } = this.parseWindow(window);

    const intervalExpr =
      unit === "m"
        ? sql.raw(`${n} * interval '1 minute'`)
        : sql.raw(`${n} * interval '1 hour'`);

    const rows = await this.db
      .select({
        time: pointValues.time,
        assetId: pointValues.assetId,
        pointKey: pointValues.pointKey,
        value: pointValues.value,
        unit: pointValues.unit,
      })
      .from(pointValues)
      .where(
        and(
          eq(pointValues.assetId, assetId),
          eq(pointValues.pointKey, pointKey),
          gte(pointValues.time, sql`now() - ${intervalExpr}`),
        ),
      )
      .orderBy(desc(pointValues.time))
      .limit(limit);

    return rows.map((r) => ({
      time: r.time.toISOString(),
      assetId: r.assetId,
      pointKey: r.pointKey,
      value: r.value,
      unit: r.unit,
    }));
  }

  /**
   * `F3.35` Stage A (ADR 0048 decision 3) — the general aggregate read.
   *
   * The four existing aggregate reads on `@Controller("dashboard")` are fixed
   * shapes for fixed pages. This one answers an arbitrary point over an
   * arbitrary window from the ADR 0023 rollup relations.
   *
   * **One statement, so the three halves share a transaction snapshot.** The
   * current window's scalars, the compare window's scalars and the bucket rows
   * could otherwise straddle an incoming write, and the chart's footer would
   * disagree with the plot it sits under — a discrepancy that looks like an
   * arithmetic bug and is not one.
   *
   * **`TENANT_POOL`, matching `recentForPoint`'s `TENANT_DRIZZLE`.** The
   * `telemetry.*` relations carry no Row Level Security — ADR 0043's policies
   * are on `bms.*` — so no pool filters them and the **controller's
   * `canReadAsset` guard is the only containment there is**. That is why ADR
   * 0048's Consequences name the access check as the security-relevant part of
   * this endpoint, and why it runs before this method is called rather than
   * inside it. `0042`/`0045` grant `bms_tenant` SELECT on these aggregates.
   *
   * `F4.297` (ADR 0108 decisions 1.2, 1.3 and 1.9): the range arrives resolved
   * (`resolveAggregateRange`, the one rule the route and the copilot tool both
   * use), so a custom `from`/`to` and a trailing window take the same path.
   * With a compare and a `bucketFunction`, the compare window's buckets come
   * back too, at their true timestamps; `bucketStats` adds min, weighted mean,
   * max and sample count to every bucket. The response's `timeZone` is the
   * asset's site zone (location, else organization), read on the fleet pool —
   * the controller's `canReadAsset` has run before this is called.
   *
   * @param now injectable for tests only; defaults to the current instant. It
   *   is the retention guard's clock, not the window's end.
   */
  async pointAggregate(
    point: { assetId: string; pointKey: string },
    {
      from,
      to,
      windowMinutes,
      compare,
      bucketFunction,
      bucketStats = false,
      now = new Date(),
    }: AggregateRange & {
      compare: boolean;
      bucketFunction?: PointAggregateFunction;
      bucketStats?: boolean;
      now?: Date;
    },
  ): Promise<PointAggregateResponse> {
    // **Takes the DECODED pair, not the `pointRef` string** (security review,
    // LOW). The controller has already decoded it to run `canReadAsset`, so
    // taking the string here would mean decoding it twice and trusting the two
    // results to agree. There is no Row Level Security on
    // `telemetry.point_values_*` to catch it if they ever do not.
    const { assetId, pointKey } = point;

    const window = windowBoundsFor({ from, to }, compare);
    const level = levelFor(window, windowMinutes, now);
    const comparing = window.compareFrom !== null && window.compareTo !== null;

    const ctes = [`cur AS (${scalarSql(level, 3, 4)})`];
    const params: unknown[] = [assetId, pointKey, window.from, window.to];
    if (comparing) {
      params.push(window.compareFrom, window.compareTo);
      ctes.push(`prev AS (${scalarSql(level, 5, 6)})`);
    }
    if (bucketFunction) {
      ctes.push(`bkt AS (${bucketSql(bucketFunction, level, 3, 4, bucketStats)})`);
      if (comparing) {
        // The compare buckets: the same fragment at the compare window's
        // parameters, in the same statement and snapshot.
        ctes.push(`pbkt AS (${bucketSql(bucketFunction, level, 5, 6, bucketStats)})`);
      }
    }

    const bucketJson = bucketStats
      ? "json_build_object('t', t, 'v', v, 'min', min, 'average', average, 'max', max, 'sample_count', sample_count)"
      : "json_build_object('t', t, 'v', v)";
    const columns = [
      "to_jsonb(cur.*) AS cur",
      comparing ? "(SELECT to_jsonb(prev.*) FROM prev) AS prev" : "NULL::jsonb AS prev",
      bucketFunction
        ? `(SELECT json_agg(${bucketJson} ORDER BY t) FROM bkt) AS buckets`
        : "NULL::json AS buckets",
      bucketFunction && comparing
        ? `(SELECT json_agg(${bucketJson} ORDER BY t) FROM pbkt) AS prev_buckets`
        : "NULL::json AS prev_buckets",
    ];

    const [result, zone] = await Promise.all([
      this.pool.query<{
        cur: ScalarRow;
        prev: ScalarRow | null;
        buckets: BucketRow[] | null;
        prev_buckets: BucketRow[] | null;
      }>(`WITH ${ctes.join(", ")} SELECT ${columns.join(", ")} FROM cur`, params),
      this.siteTimeZoneOfAsset(assetId),
    ]);

    // `cur` is an aggregate with no GROUP BY, so it yields exactly one row even
    // over an empty window — every statistic simply comes back NULL.
    const row = result.rows[0];
    if (!row) {
      throw new Error("point aggregate returned no row; an ungrouped aggregate always yields one");
    }

    // **`buckets: null` means "not asked for", and nothing else.** `json_agg`
    // over zero rows is SQL `NULL`, so a window with no data at all came back
    // indistinguishable from a tile's request — the browser check saw exactly
    // that. A caller that named a `bucketFunction` always gets an array, even
    // when every entry in it is `null`.
    const buckets = bucketFunction ? (row.buckets ?? []) : null;
    const prevBuckets = bucketFunction && comparing ? (row.prev_buckets ?? []) : null;
    // Checked against what THIS window and level should yield, not only the
    // global worst case: a coarse read cannot otherwise trip the guard, since
    // a 30-day window returning 2,880 rows sits exactly at the global bound.
    // The compare window has the same length, so the same expectation holds.
    for (const array of [buckets, prevBuckets]) {
      if (array) {
        assertBucketCount(array.length, expectedBucketCount(windowMinutes, level));
      }
    }
    const seconds = bucketSeconds(level);

    return {
      // Rebuilt from the decoded pair rather than echoed from the request, so
      // the response names the point that was actually read.
      pointRef: encodePointRef(assetId, pointKey),
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      bucketSeconds: seconds,
      stats: this.toStats(row.cur),
      // The stored name (`UTC` stays `UTC`), as the energy view reports it.
      timeZone: zone.timeZone,
      compare:
        window.compareFrom && window.compareTo && row.prev
          ? {
              from: window.compareFrom.toISOString(),
              to: window.compareTo.toISOString(),
              stats: this.toStats(row.prev),
              // True timestamps: the client shifts each by the span for an
              // overlay (ADR 0108 decision 1.3). `null` when no bucketFunction.
              buckets: prevBuckets
                ? toResponseBuckets(prevBuckets, window.compareFrom, window.compareTo, seconds, bucketStats)
                : null,
            }
          : null,
      // Gap-filled, so an hour with no telemetry arrives as `v: null` rather
      // than as an absent row. ECharts sets no `connectNulls`, so it breaks the
      // line at a null and interpolates straight across a missing point — an
      // outage would otherwise be drawn as data.
      buckets: buckets ? toResponseBuckets(buckets, window.from, window.to, seconds, bucketStats) : null,
    };
  }

  /**
   * `F4.297` (ADR 0108 decision 1.9) — the asset's site zone: its location's
   * stored `timezone`, else its organization's, through the one shared chain
   * (`resolveSiteTimeZone`; an invalid stored zone falls to the next link, a
   * stored `UTC` stays `UTC`). One `FLEET_POOL` statement, run only after the
   * controller's `canReadAsset`; an asset with no row answers `UTC`.
   */
  private async siteTimeZoneOfAsset(assetId: string) {
    const result = await this.fleetPool.query<{ location_zone: string | null; organization_zone: string | null }>(
      `SELECT l.timezone AS location_zone, o.timezone AS organization_zone
         FROM bms.assets a
         LEFT JOIN bms.locations l ON l.id = a.location_id
         LEFT JOIN bms.organizations o ON o.id = a.organization_id
        WHERE a.id = $1`,
      [assetId],
    );
    const row = result.rows[0];
    return resolveSiteTimeZone(row?.location_zone ?? null, row?.organization_zone ?? null);
  }

  /**
   * `F3.28` (ADR 0074 decision 2) — for each requested point, the latest sample
   * with `time <= at`, in one statement.
   *
   * The result has **one entry per requested point, in request order**,
   * duplicates included: `unnest … WITH ORDINALITY` numbers the requests and
   * `LEFT JOIN LATERAL` keeps a point with no sample as a row of nulls (the
   * `rule-samples.ts` shape is a `CROSS JOIN`, which would drop it). Mapped
   * back by ordinal rather than trusting row order alone.
   *
   * **`TENANT_POOL`, like `pointAggregate`** — and the controller's scope guard
   * is the only containment, since `telemetry.point_values` has no RLS.
   */
  async pointValuesAt(
    points: readonly { assetId: string; pointKey: string }[],
    at: Date,
  ): Promise<{ time: string | null; value: number | null; unit: string | null }[]> {
    if (points.length === 0) {
      return [];
    }
    const result = await this.pool.query<{
      ord: string;
      time: Date | null;
      value: number | string | null;
      unit: string | null;
    }>(
      `SELECT r.ord, s.time, s.value, s.unit
       FROM unnest($1::uuid[], $2::text[]) WITH ORDINALITY AS r(asset_id, point_key, ord)
       LEFT JOIN LATERAL (
         SELECT pv.time, pv.value, pv.unit
         FROM telemetry.point_values pv
         WHERE pv.asset_id = r.asset_id
           AND pv.point_key = r.point_key
           AND pv.time <= $3::timestamptz
         ORDER BY pv.time DESC
         LIMIT 1
       ) s ON true
       ORDER BY r.ord`,
      [points.map((p) => p.assetId), points.map((p) => p.pointKey), at.toISOString()],
    );

    const byOrdinal = new Map(result.rows.map((row) => [Number(row.ord), row]));
    return points.map((_, i) => {
      const row = byOrdinal.get(i + 1);
      if (!row || row.time === null) {
        return { time: null, value: null, unit: null };
      }
      return {
        time: new Date(row.time).toISOString(),
        value: numberOrNull(row.value),
        unit: row.unit,
      };
    });
  }

  /**
   * `F4.297` (ADR 0108 decision 1.6) — one page of a point's stored samples,
   * newest first, for `GET /telemetry/points/:pointRef/raw`.
   *
   * **A keyset cursor on `time`.** The primary key is `(time, asset_id,
   * point_key)`, so one point has at most one row per instant and
   * `time < $3` neither skips nor repeats a row between pages. The read is one
   * probe of `point_values_point_asset_time_idx (point_key, asset_id, time
   * desc)` with `LIMIT`.
   *
   * **`limit + 1` rows are read** (the `recentForPoint` / `get_recent_values`
   * idiom): a `limit + 1`-th row tells "more" from "at the bound". When it
   * exists, `nextBefore` is the `limit`-th row's time; otherwise `null`.
   *
   * **The upper bound is a bound parameter (`before`, else `now`), not SQL
   * `now()`** — `now()` is only STABLE, so the planner cannot exclude chunks
   * at Bind (the note at {@link latestPointValues}).
   *
   * **`TENANT_POOL`, like `pointAggregate`.** `telemetry.point_values` has no
   * Row Level Security; the controller's `canReadAsset` has placed the asset
   * before this is called, and takes the DECODED pair for the reason
   * `pointAggregate` gives.
   *
   * @param now injectable for tests; the newest page's exclusive upper bound.
   */
  async pointRawRecords(
    point: { assetId: string; pointKey: string },
    { limit, before, now = new Date() }: { limit: number; before?: Date; now?: Date },
  ): Promise<PointRawRecordsResponse> {
    const { assetId, pointKey } = point;
    const result = await this.pool.query<{
      time: Date;
      device_time: Date | null;
      value: number | string;
      unit: string | null;
    }>(
      `SELECT time, device_time, value, unit
       FROM telemetry.point_values
       WHERE asset_id = $1
         AND point_key = $2
         AND time < $3::timestamptz
       ORDER BY time DESC
       LIMIT $4`,
      [assetId, pointKey, (before ?? now).toISOString(), limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const items = rows.map((row) => ({
      time: new Date(row.time).toISOString(),
      deviceTime: row.device_time === null ? null : new Date(row.device_time).toISOString(),
      value: Number(row.value),
      unit: row.unit,
    }));
    const more = result.rows.length > limit;
    return {
      pointRef: encodePointRef(assetId, pointKey),
      items,
      nextBefore: more ? (items[items.length - 1]?.time ?? null) : null,
    };
  }

  /**
   * `F4.176` (ADR 0074 Amendment 2) — the latest sample of each (asset, point
   * key) pair with a sample in the last `windowMinutes`, in one statement. A
   * pair with no sample in the window is absent from the result.
   *
   * **One index probe per requested pair (`LATERAL … LIMIT 1`), not a
   * `DISTINCT ON` over the window.** A `DISTINCT ON` reads and sorts every
   * sample in the window, so its cost grows with the window and the sample
   * rate: over 60 minutes of the SMOC set (171,081 rows) it sorted to disk in
   * 0.8–2.6 s, and the index-ordered variant took 14.7 s cold. The probe's cost
   * is bounded by the pair count instead (at most 50 × 64): 62–109 ms for the
   * same 60 minutes, 161 ms for 15 minutes, 84 ms when the window is empty.
   * Raised by the `F4.176` security review (L1); measured 2026-09-30.
   *
   * **The lower bound is a bound `timestamptz` computed here, not
   * `now() - $n`.** node-pg sends an unnamed statement, which Postgres plans at
   * Bind with the value known, so the old chunks are excluded while planning.
   * `now()` is only STABLE, so `now() - …` plans every chunk first (350 ms for
   * the SMOC set; ADR 0074 Amendment 1 item 6 records the same trap). Measured:
   * 2–12 ms planning.
   *
   * **Duplicate ids and keys are dropped before the query**, because the cross
   * join would answer a repeated pair twice.
   *
   * **`TENANT_POOL`, like `pointValuesAt`** — the controller's scope guard is
   * the only containment, since `telemetry.point_values` has no RLS.
   */
  async latestPointValues(
    assetIds: readonly string[],
    pointKeys: readonly string[],
    windowMinutes: number,
  ): Promise<TelemetryReading[]> {
    const since = new Date(Date.now() - windowMinutes * 60_000);
    const result = await this.pool.query<{
      time: Date;
      asset_id: string;
      point_key: string;
      value: number | string;
      unit: string | null;
    }>(
      `SELECT s.time, a.asset_id, k.point_key, s.value, s.unit
       FROM unnest($1::uuid[]) AS a(asset_id)
       CROSS JOIN unnest($2::text[]) AS k(point_key)
       CROSS JOIN LATERAL (
         SELECT pv.time, pv.value, pv.unit
         FROM telemetry.point_values pv
         WHERE pv.asset_id = a.asset_id
           AND pv.point_key = k.point_key
           AND pv.time > $3::timestamptz
         ORDER BY pv.time DESC
         LIMIT 1
       ) s`,
      [[...new Set(assetIds)], [...new Set(pointKeys)], since.toISOString()],
    );
    return result.rows.map((row) => ({
      time: new Date(row.time).toISOString(),
      assetId: row.asset_id,
      pointKey: row.point_key,
      value: Number(row.value),
      unit: row.unit,
    }));
  }

  /**
   * `F4.291` PR 3 (ADR 0099 Amendment 9 E5(c)) — one point key over up to 25
   * assets for `[from, to)`: min / mean / max / sample count per asset at the
   * ladder's level for the window's length, and `last` / `lastAt`, the newest
   * 1-minute bucket's mean (owner ruling P6) — both levels through the
   * retention guard. **One statement**, so the two halves share a snapshot.
   * An asset with no sample in the window has no row; the copilot tool fills
   * it with nulls.
   *
   * The statistics and `last` read the same period, `[coveredFrom,
   * coveredTo)`: the whole 1-minute buckets inside the asked window, with the
   * coarse level read only for its whole buckets inside that and the two
   * partial ends from 1 minute (`pointStatsWindow`; the rollups bucket in
   * UTC, an IST week does not). The answer names that period beside the
   * asked one.
   *
   * **`TENANT_POOL`, like `pointAggregate`**: `telemetry.*` has no Row Level
   * Security, so the caller places every id first (the copilot tool through
   * `organizationsOfAssets` or the location helper) and each fragment reads
   * only `ANY(ids)`. No ids → the empty answer and no query.
   *
   * A window past `MAX_WIDGET_WINDOW_MINUTES` (or not after `from`), or more
   * than 25 distinct ids, is refused; both are defensive — the tool's
   * 31-day refine and its 25-id page bound make them unreachable there.
   *
   * @param now injectable for tests only; defaults to the current instant.
   */
  async pointStatsByAsset({
    assetIds,
    pointKey,
    from,
    to,
    now = new Date(),
  }: {
    assetIds: readonly string[];
    pointKey: string;
    from: Date;
    to: Date;
    now?: Date;
  }): Promise<PointStatsByAsset> {
    const windowMinutes = (to.getTime() - from.getTime()) / 60_000;
    if (!(windowMinutes > 0) || windowMinutes > MAX_WIDGET_WINDOW_MINUTES) {
      throw new BadRequestException(`The window must end after it starts and span at most ${MAX_WIDGET_WINDOW_MINUTES} minutes`);
    }
    const ids = [...new Set(assetIds)];
    if (ids.length > POINT_STATS_MAX_ASSETS) {
      throw new BadRequestException(`At most ${POINT_STATS_MAX_ASSETS} assets`);
    }
    const window = pointStatsWindow(from, to, now);
    const answer = {
      pointKey,
      from: from.toISOString(),
      to: to.toISOString(),
      coveredFrom: window.coveredFrom.toISOString(),
      coveredTo: window.coveredTo.toISOString(),
      bucketSeconds: bucketSeconds(window.level),
    };
    if (ids.length === 0) {
      return { ...answer, rows: [] };
    }
    const result = await this.pool.query<{
      asset_id: string;
      average: number | string | null;
      min: number | string | null;
      max: number | string | null;
      sample_count: number | string | null;
      last: number | string | null;
      last_at: Date | string | null;
    }>(
      `WITH agg AS (${groupedScalarSql(window.level, window.edgeLevel)}), lst AS (${lastBucketSql(window.edgeLevel, 1, 2, 3, 4)})
       SELECT coalesce(agg.asset_id, lst.asset_id) AS asset_id, agg.average, agg.min, agg.max, agg.sample_count, lst.last, lst.last_at
       FROM agg FULL JOIN lst ON lst.asset_id = agg.asset_id
       ORDER BY 1`,
      [ids, pointKey, answer.coveredFrom, answer.coveredTo, window.wholeFrom.toISOString(), window.wholeTo.toISOString()],
    );
    return {
      ...answer,
      rows: result.rows.map((row) => ({
        assetId: row.asset_id,
        min: numberOrNull(row.min),
        avg: numberOrNull(row.average),
        max: numberOrNull(row.max),
        last: numberOrNull(row.last),
        lastAt: row.last_at === null ? null : new Date(row.last_at).toISOString(),
        sampleCount: Number(row.sample_count ?? 0),
      })),
    };
  }

  /**
   * `F4.296` (ADR 0099 Amendment 10 F1) — one point key's site summary over
   * every id asked (the copilot's `get_point_stats` `summary`, a location's
   * readable subtree): the whole set's min / mean / max / sample count and
   * each asset's, over the same covered period and levels as
   * {@link pointStatsByAsset}, in **one statement**
   * (`groupedScalarSql(…, withSite)`), so the site row is the exact
   * composition of the asset rows. No `last`. No 25-id bound: the statement
   * returns one row per asset with a sample plus one, whatever the subtree's
   * size. Only assets with a sample have a row.
   *
   * The same containment as {@link pointStatsByAsset}: `TENANT_POOL`, the
   * caller places every id first, and the fragments read only `ANY(ids)`. No
   * ids → the empty answer and no query. The same window refusal.
   *
   * @param now injectable for tests only; defaults to the current instant.
   */
  async pointStatsSummary({
    assetIds,
    pointKey,
    from,
    to,
    now = new Date(),
  }: {
    assetIds: readonly string[];
    pointKey: string;
    from: Date;
    to: Date;
    now?: Date;
  }): Promise<PointStatsSummary> {
    const windowMinutes = (to.getTime() - from.getTime()) / 60_000;
    if (!(windowMinutes > 0) || windowMinutes > MAX_WIDGET_WINDOW_MINUTES) {
      throw new BadRequestException(`The window must end after it starts and span at most ${MAX_WIDGET_WINDOW_MINUTES} minutes`);
    }
    const ids = [...new Set(assetIds)];
    const window = pointStatsWindow(from, to, now);
    const answer = {
      pointKey,
      from: from.toISOString(),
      to: to.toISOString(),
      coveredFrom: window.coveredFrom.toISOString(),
      coveredTo: window.coveredTo.toISOString(),
      bucketSeconds: bucketSeconds(window.level),
    };
    if (ids.length === 0) {
      return { ...answer, site: { min: null, avg: null, max: null, sampleCount: 0 }, rows: [] };
    }
    const result = await this.pool.query<{
      asset_id: string | null;
      average: number | string | null;
      min: number | string | null;
      max: number | string | null;
      sample_count: number | string | null;
      is_site: boolean;
    }>(`${groupedScalarSql(window.level, window.edgeLevel, [1, 2, 3, 4, 5, 6], true)} ORDER BY 1`, [
      ids,
      pointKey,
      answer.coveredFrom,
      answer.coveredTo,
      window.wholeFrom.toISOString(),
      window.wholeTo.toISOString(),
    ]);
    const figures = (row: (typeof result.rows)[number]) => ({
      min: numberOrNull(row.min),
      avg: numberOrNull(row.average),
      max: numberOrNull(row.max),
      sampleCount: Number(row.sample_count ?? 0),
    });
    const site = result.rows.find((row) => row.is_site);
    return {
      ...answer,
      site: site === undefined ? { min: null, avg: null, max: null, sampleCount: 0 } : figures(site),
      rows: result.rows.flatMap((row) => (row.is_site || row.asset_id === null ? [] : [{ assetId: row.asset_id, ...figures(row) }])),
    };
  }

  /**
   * Postgres renders a `timestamptz` inside `to_jsonb` as `+00:00`, not `Z`, and
   * a `bigint` as a JSON number. Both are normalised here so the response
   * matches `pointAggregateStatsSchema` rather than nearly matching it.
   */
  private toStats(row: ScalarRow): PointAggregateStats {
    return {
      sum: numberOrNull(row.sum),
      average: numberOrNull(row.average),
      min: numberOrNull(row.min),
      max: numberOrNull(row.max),
      peakAt: row.peak_at === null ? null : new Date(row.peak_at).toISOString(),
      sampleCount: Number(row.sample_count ?? 0),
    };
  }

  private parseWindow(raw?: string): { n: number; unit: "m" | "h" } {
    const w = (raw ?? "15m").trim();
    const m = /^(\d+)(m|h)$/.exec(w);
    if (!m) {
      throw new BadRequestException(
        'Invalid window; use suffix m or h (e.g. "15m", "1h")',
      );
    }
    const n = Number(m[1]);
    const unit = m[2] as "m" | "h";
    if (n < 1 || n > 168) {
      throw new BadRequestException("Window out of range (1–168 m or h)");
    }
    return { n, unit };
  }
}
