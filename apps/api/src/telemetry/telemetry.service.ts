import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Pool } from "pg";

import { pointValues } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  decodePointRefParam,
  encodePointRef,
  type PointAggregateFunction,
  type PointAggregateResponse,
  type PointAggregateStats,
  type TelemetryReading,
} from "@bms/shared";

import { TENANT_DRIZZLE, TENANT_POOL } from "../database/database.tokens";
import {
  assertBucketCount,
  bucketSql,
  expectedBucketCount,
  fillBucketGaps,
  levelFor,
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
   */
  async recentForPoint(pointRef: string, window?: string): Promise<TelemetryReading[]> {
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
      .limit(5000);

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
