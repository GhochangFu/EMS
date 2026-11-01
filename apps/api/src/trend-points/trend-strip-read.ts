import type { Pool } from "pg";

import type { AggregateLevel } from "@bms/shared";

import { aggregateRelation, avgExpr } from "../telemetry/point-aggregates";
import { type StripRow, assertSeriesRowCount } from "./trend-strip.pure";

/**
 * `F4.301` U2 / ADR 0108 Amendment 2 items 4 and 5 — the trend strip's one
 * telemetry statement: every `(asset, code)` pair of the plan, folded from the
 * declared level into the strip's buckets over `[from, to)`.
 *
 * **The pair bound.** Telemetry has no RLS: the pair arrays are the isolation
 * control. They are bound as `$1::uuid[]` / `$2::text[]` and joined, with no
 * nullable leg — the caller resolves a global admin to an explicit asset list
 * before it gets here. An empty pair list returns `[]` before any statement.
 *
 * **The fold.** Several `_5m` (or `_1h`) rows fold into one output bucket, so
 * the mean is `avgExpr` — `sum(sum_value) / sum(sample_count)`, the only form
 * that composes (ADR 0023); a mean of the rows' means would weight a 3-sample
 * row and a 1-sample row alike. The relation is the closed `aggregateRelation`
 * lookup, never a literal.
 *
 * **The bound.** `LIMIT` is pairs × folds + 1, and {@link assertSeriesRowCount}
 * refuses the extra row: it is reachable only when the window is not aligned
 * or a relation's width disagrees with the level.
 */

type Queryable = Pick<Pool, "query">;

export type TrendStripReadInput = {
  readonly level: AggregateLevel;
  /** The output fold width; divides `to − from`. */
  readonly bucketSeconds: number;
  readonly from: Date;
  readonly to: Date;
  readonly pairs: readonly { readonly assetId: string; readonly pointKey: string }[];
};

/** Reads every planned (asset, point) series of the strip window in one rollup statement. */
export async function trendStripRead(pool: Queryable, input: TrendStripReadInput): Promise<StripRow[]> {
  if (input.pairs.length === 0) {
    return [];
  }
  const relation = aggregateRelation(input.level);
  if (relation === undefined) {
    throw new Error(`trendStripRead: no aggregate relation for level "${String(input.level)}"`);
  }
  const buckets = Math.ceil((input.to.getTime() - input.from.getTime()) / (input.bucketSeconds * 1_000));
  const expected = input.pairs.length * buckets;

  const r = await pool.query<{ asset_id: string; point_key: string; t: Date | string; v: number | string | null }>(
    `
    WITH pairs AS (
      SELECT unnest($1::uuid[]) AS asset_id, unnest($2::text[]) AS point_key
    )
    SELECT
      p.asset_id,
      p.point_key,
      time_bucket($5::interval, r.bucket) AS t,
      CASE WHEN sum(r.sample_count) > 0 THEN ${avgExpr("r")}::float8 END AS v
    FROM pairs p
    JOIN ${relation} r ON r.asset_id = p.asset_id AND r.point_key = p.point_key
    WHERE r.bucket >= $3::timestamptz
      AND r.bucket < $4::timestamptz
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    LIMIT ${expected + 1}
    `,
    [
      input.pairs.map((p) => p.assetId),
      input.pairs.map((p) => p.pointKey),
      input.from,
      input.to,
      `${input.bucketSeconds} seconds`,
    ],
  );
  assertSeriesRowCount(r.rows.length, expected);
  return r.rows.map((row) => ({
    assetId: row.asset_id,
    pointKey: row.point_key,
    t: new Date(row.t).toISOString(),
    v: row.v === null ? null : Number(row.v),
  }));
}
