import { and, desc, eq, sql } from "drizzle-orm";

import { pointValues } from "@bms/db";
import type { BmsDb } from "@bms/db";

import type { LatestSampleLoader } from "./rule-evaluation";
import type { RuleRow } from "./rules.types";

/**
 * The telemetry-sample loaders for the rules evaluators.
 *
 * Extracted from `rules.service.ts` for the AGENTS.md §4.5 1000-line cap when
 * `E7.1b` grew the service's write path. They read `telemetry.point_values`,
 * which is **not** a `bms.*` table and gains no `0047` policy, so they run on
 * the tenant pool with no GUC — the same handle the caller already holds — and
 * did not move to `fleetDb` with the rest of this service's reads.
 */

/** The latest sample for one `(assetId, pointKey)` pair. */
export async function latestPointValue(
  db: BmsDb,
  assetId: string,
  pointKey: string,
): Promise<{ time: Date; value: number; unit: string | null } | null> {
  const [sample] = await db
    .select({
      time: pointValues.time,
      value: pointValues.value,
      unit: pointValues.unit,
    })
    .from(pointValues)
    .where(and(eq(pointValues.assetId, assetId), eq(pointValues.pointKey, pointKey)))
    .orderBy(desc(pointValues.time))
    .limit(1);
  return sample ?? null;
}

/**
 * The latest sample for every `(assetId, pointKey)` pair any threshold rule
 * in `rows` needs, in one query.
 *
 * NOT the `DISTINCT ON` idiom `dashboard.service.ts`/`map.service.ts` use
 * for the same "latest per group" shape, and that absence is deliberate,
 * not an oversight: code review measured why. `DISTINCT ON` joined against
 * an explicit pairs list cannot drive `point_values_point_asset_time_idx`
 * the way it can when the join key is one specific asset already in scope,
 * so Postgres falls back to scanning every chunk (decompressing the
 * compressed ones) and sorting the result -- measured 613ms for 337 pairs
 * against this table's 740k live rows on the running stack, worse
 * wall-clock than the pre-batch shape looked on paper even though it is
 * still one query instead of many. `CROSS JOIN LATERAL ... ORDER BY time
 * DESC LIMIT 1` below lets the planner drive an index scan per pair
 * instead -- measured 16ms for the identical 337 pairs. Both forms were
 * timed with `EXPLAIN (ANALYZE, BUFFERS)` against the live stack before
 * choosing this one; neither number was assumed from the idiom's shape.
 *
 * Returns a `LatestSampleLoader`: a rule this batch has no sample for
 * (never published, or genuinely no telemetry yet) resolves to `null` from
 * the map lookup -- `evaluateThresholdRule` already treats that as
 * `skipped`, not `error`, so no caller-visible behaviour changes.
 */
export async function batchedLatestPointValues(
  db: BmsDb,
  rows: RuleRow[],
): Promise<LatestSampleLoader> {
  const pairs = new Map<string, { assetId: string; pointKey: string }>();
  for (const row of rows) {
    if (row.ruleType === "threshold" && row.assetId && row.pointKey) {
      pairs.set(`${row.assetId}:${row.pointKey}`, {
        assetId: row.assetId,
        pointKey: row.pointKey,
      });
    }
  }
  const unique = [...pairs.values()];
  const samples = new Map<string, { time: Date; value: number; unit: string | null }>();

  if (unique.length > 0) {
    const valuesList = sql.join(
      unique.map(({ assetId, pointKey }) => sql`(${assetId}::uuid, ${pointKey}::varchar)`),
      sql`, `,
    );
    const result = await db.execute<{
      asset_id: string;
      point_key: string;
      time: Date;
      value: number;
      unit: string | null;
    }>(sql`
      WITH pairs (asset_id, point_key) AS (VALUES ${valuesList})
      SELECT p.asset_id, p.point_key, s.time, s.value, s.unit
      FROM pairs p
      CROSS JOIN LATERAL (
        SELECT pv.time, pv.value, pv.unit
        FROM telemetry.point_values pv
        WHERE pv.asset_id = p.asset_id AND pv.point_key = p.point_key
        ORDER BY pv.time DESC
        LIMIT 1
      ) s
    `);

    for (const r of result.rows) {
      samples.set(`${r.asset_id}:${r.point_key}`, {
        time: new Date(r.time),
        value: r.value,
        unit: r.unit,
      });
    }
  }

  return async (assetId, pointKey) => samples.get(`${assetId}:${pointKey}`) ?? null;
}
