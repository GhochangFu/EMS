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
  type PointAggregateFunction,
  type PointAggregateResponse,
  type PointAggregateStats,
  type PointStatsByAsset,
  type TelemetryReading,
} from "@bms/shared";

import { TENANT_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import {
  assertBucketCount,
  bucketSql,
  expectedBucketCount,
  fillBucketGaps,
  groupedScalarSql,
  lastBucketSql,
  levelFor,
  pointStatsLevels,
  scalarSql,
  windowBounds,
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
}

@Injectable()
export class TelemetryService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(TENANT_POOL) private readonly pool: Pool,
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
   * @param now injectable for tests only; defaults to the current instant.
   */
  async pointAggregate(
    point: { assetId: string; pointKey: string },
    {
      windowMinutes,
      compare,
      bucketFunction,
      now = new Date(),
    }: {
      windowMinutes: number;
      compare: boolean;
      bucketFunction?: PointAggregateFunction;
      now?: Date;
    },
  ): Promise<PointAggregateResponse> {
    // **Takes the DECODED pair, not the `pointRef` string** (security review,
    // LOW). The controller has already decoded it to run `canReadAsset`, so
    // taking the string here would mean decoding it twice and trusting the two
    // results to agree. There is no Row Level Security on
    // `telemetry.point_values_*` to catch it if they ever do not.
    const { assetId, pointKey } = point;

    const window = windowBounds(now, windowMinutes, compare);
    const level = levelFor(window, windowMinutes, now);

    const ctes = [`cur AS (${scalarSql(level, 3, 4)})`];
    const params: unknown[] = [assetId, pointKey, window.from, window.to];
    if (window.compareFrom && window.compareTo) {
      params.push(window.compareFrom, window.compareTo);
      ctes.push(`prev AS (${scalarSql(level, 5, 6)})`);
    }
    if (bucketFunction) {
      ctes.push(`bkt AS (${bucketSql(bucketFunction, level, 3, 4)})`);
    }

    const columns = [
      "to_jsonb(cur.*) AS cur",
      window.compareFrom ? "(SELECT to_jsonb(prev.*) FROM prev) AS prev" : "NULL::jsonb AS prev",
      bucketFunction
        ? "(SELECT json_agg(json_build_object('t', t, 'v', v) ORDER BY t) FROM bkt) AS buckets"
        : "NULL::json AS buckets",
    ];

    const result = await this.pool.query<{
      cur: ScalarRow;
      prev: ScalarRow | null;
      buckets: BucketRow[] | null;
    }>(`WITH ${ctes.join(", ")} SELECT ${columns.join(", ")} FROM cur`, params);

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
    if (buckets) {
      // Checked against what THIS window and level should yield, not only the
      // global worst case: a coarse read cannot otherwise trip the guard, since
      // a 30-day window returning 2,880 rows sits exactly at the global bound.
      assertBucketCount(buckets.length, expectedBucketCount(windowMinutes, level));
    }

    return {
      // Rebuilt from the decoded pair rather than echoed from the request, so
      // the response names the point that was actually read.
      pointRef: encodePointRef(assetId, pointKey),
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      bucketSeconds: bucketSeconds(level),
      stats: this.toStats(row.cur),
      compare:
        window.compareFrom && window.compareTo && row.prev
          ? {
              from: window.compareFrom.toISOString(),
              to: window.compareTo.toISOString(),
              stats: this.toStats(row.prev),
            }
          : null,
      // Gap-filled, so an hour with no telemetry arrives as `v: null` rather
      // than as an absent row. ECharts sets no `connectNulls`, so it breaks the
      // line at a null and interpolates straight across a missing point — an
      // outage would otherwise be drawn as data.
      buckets: buckets
        ? fillBucketGaps(
            buckets.map((b) => ({ t: new Date(b.t).toISOString(), v: numberOrNull(b.v) })),
            window.from,
            window.to,
            bucketSeconds(level),
          )
        : null,
    };
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
   * retention guard (`pointStatsLevels`). **One statement**, so the two halves
   * share a snapshot. An asset with no sample in the window has no row; the
   * copilot tool fills it with nulls.
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
    const { level, lastLevel } = pointStatsLevels(from, to, now);
    const answer = { pointKey, from: from.toISOString(), to: to.toISOString(), bucketSeconds: bucketSeconds(level) };
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
      `WITH agg AS (${groupedScalarSql(level, 1, 2, 3, 4)}), lst AS (${lastBucketSql(lastLevel, 1, 2, 3, 4)})
       SELECT coalesce(agg.asset_id, lst.asset_id) AS asset_id, agg.average, agg.min, agg.max, agg.sample_count, lst.last, lst.last_at
       FROM agg FULL JOIN lst ON lst.asset_id = agg.asset_id
       ORDER BY 1`,
      [ids, pointKey, from.toISOString(), to.toISOString()],
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
