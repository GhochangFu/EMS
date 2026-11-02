import type { Pool } from "pg";

import type { AggregateLevel } from "@bms/shared";

import type { BaselineWindow } from "../reports/energy-abnormal";
import { displayGroupExpr } from "../reports/energy-view-read";
import { aggregateRelation, avgExpr } from "../telemetry/point-aggregates";
import type { SegmentWindowRow } from "./segment-abnormal";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 4) — the segment view's two
 * telemetry statements, compare or not.
 *
 * **(A) `segmentWindowReads`.** The `entityWindowReads` shape: the windows are
 * bound as three parallel arrays and unnested (`idx 0` the current period,
 * `idx −1` the compare period, `idx 1..n` the baseline windows), so no window
 * value is interpolated; one row per (window, asset) with data. The point code
 * is bound (`$4`), never a literal, and the asset list is `= ANY($5::uuid[])`
 * with no nullable leg: telemetry has no RLS, so the list is the isolation
 * control, and the caller has already resolved a global admin to the site's
 * explicit list. Per row: the weighted mean (`avgExpr`, ADR 0023 — a mean of
 * the rows' means would weight a 3-sample row and a 1-sample row alike), the
 * max of `max_value` with the bucket it fell in (the earliest on a tie), the
 * sample count and the **distinct** bucket count the counting rule reads.
 *
 * **(B) `segmentSeriesRead`.** The chart's series for the top assets: the
 * asset list unnested (`$1`), the current and the compare window bound in one
 * statement (`$2..$5`; the compare pair `null` without compare), the point
 * bound (`$6`), folded into the display bucket by `displayGroupExpr` (a `1d`
 * bucket over `_1h` is a local day of the zone at `$7`). The compare series
 * keeps its true timestamps; the client shifts it by `+span` (decision 1.3).
 *
 * Bounds are inclusive (`bucket >= start AND bucket <= end`), the reports
 * path's convention. The relation is the closed `aggregateRelation` lookup,
 * never a literal. An empty asset list returns `[]` before any statement.
 */

type Queryable = Pick<Pool, "query">;

function relationFor(level: AggregateLevel): string {
  const relation = aggregateRelation(level);
  if (relation === undefined) {
    throw new Error(`segment view: no aggregate relation for level ${String(level)}`);
  }
  return relation;
}

export type SegmentWindowReadsInput = {
  readonly level: AggregateLevel;
  readonly pointKey: string;
  readonly assetIds: readonly string[];
  readonly windows: readonly BaselineWindow[];
};

/** Statement A: every (window, asset) with data, in one statement. */
export async function segmentWindowReads(pool: Queryable, input: SegmentWindowReadsInput): Promise<SegmentWindowRow[]> {
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0 || input.windows.length === 0) {
    return [];
  }
  const r = await pool.query<{
    idx: number | string;
    asset_id: string;
    mean: number | string | null;
    max: number | string | null;
    max_at: Date | string | null;
    sample_count: number | string;
    bucket_count: number | string;
  }>(
    `
    WITH w AS (
      SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::timestamptz[]) AS w(idx, ws, we)
    )
    SELECT
      w.idx,
      v.asset_id,
      CASE WHEN sum(v.sample_count) > 0 THEN ${avgExpr("v")}::float8 END AS mean,
      max(v.max_value)::float8 AS max,
      (array_agg(v.bucket ORDER BY v.max_value DESC NULLS LAST, v.bucket))[1] AS max_at,
      sum(v.sample_count)::bigint AS sample_count,
      count(DISTINCT v.bucket)::int AS bucket_count
    FROM w
    INNER JOIN ${relation} v ON v.bucket >= w.ws AND v.bucket <= w.we
    WHERE v.point_key = $4::text
      AND v.asset_id = ANY($5::uuid[])
    GROUP BY w.idx, v.asset_id
    `,
    [
      input.windows.map((w) => w.idx),
      input.windows.map((w) => w.start.toISOString()),
      input.windows.map((w) => w.end.toISOString()),
      input.pointKey,
      [...input.assetIds],
    ],
  );
  const rows: SegmentWindowRow[] = [];
  for (const row of r.rows) {
    const mean = row.mean === null ? Number.NaN : Number(row.mean);
    const max = row.max === null ? Number.NaN : Number(row.max);
    // A window with no sample carries no mean; it is no row at all, never a 0.
    if (!Number.isFinite(mean) || !Number.isFinite(max)) continue;
    rows.push({
      idx: Number(row.idx),
      assetId: row.asset_id,
      mean,
      max,
      maxAt: row.max_at === null ? null : new Date(row.max_at).toISOString(),
      sampleCount: Number(row.sample_count),
      bucketCount: Number(row.bucket_count),
    });
  }
  return rows;
}

export type SegmentSeriesReadInput = {
  readonly level: AggregateLevel;
  /** The display bucket: the level, or `1d` over a `1h` level. */
  readonly bucket: AggregateLevel;
  /** The arithmetic zone a `1d` bucket is a day of; bound only for that grouping. */
  readonly timeZone: string;
  readonly pointKey: string;
  readonly assetIds: readonly string[];
  readonly current: { readonly start: Date; readonly end: Date };
  readonly compare: { readonly start: Date; readonly end: Date } | null;
};

/** One display bucket of one asset in one period: `0` current, `−1` compare. */
export type SegmentSeriesRow = { readonly assetId: string; readonly idx: 0 | -1; readonly t: string; readonly v: number | null };

/** Statement B: the display series of the top assets over the current and the compare window, in one statement. */
export async function segmentSeriesRead(pool: Queryable, input: SegmentSeriesReadInput): Promise<SegmentSeriesRow[]> {
  const relation = relationFor(input.level);
  const group = displayGroupExpr(input.level, input.bucket, 7);
  if (input.assetIds.length === 0) {
    return [];
  }
  const params: unknown[] = [
    [...input.assetIds],
    input.current.start.toISOString(),
    input.current.end.toISOString(),
    input.compare === null ? null : input.compare.start.toISOString(),
    input.compare === null ? null : input.compare.end.toISOString(),
    input.pointKey,
  ];
  if (group !== "agg.bucket") {
    params.push(input.timeZone);
  }
  const r = await pool.query<{ asset_id: string; idx: number | string; t: Date | string; v: number | string | null }>(
    `
    WITH pairs AS (
      SELECT unnest($1::uuid[]) AS asset_id
    )
    SELECT
      p.asset_id,
      CASE WHEN agg.bucket >= $2::timestamptz THEN 0 ELSE -1 END AS idx,
      ${group} AS t,
      CASE WHEN sum(agg.sample_count) > 0 THEN ${avgExpr("agg")}::float8 END AS v
    FROM pairs p
    INNER JOIN ${relation} agg ON agg.asset_id = p.asset_id
    WHERE agg.point_key = $6::text
      AND (
        (agg.bucket >= $2::timestamptz AND agg.bucket <= $3::timestamptz)
        OR (agg.bucket >= $4::timestamptz AND agg.bucket <= $5::timestamptz)
      )
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    `,
    params,
  );
  return r.rows.map((row) => ({
    assetId: row.asset_id,
    idx: Number(row.idx) === 0 ? 0 : -1,
    t: new Date(row.t).toISOString(),
    v: row.v === null ? null : Number(row.v),
  }));
}
