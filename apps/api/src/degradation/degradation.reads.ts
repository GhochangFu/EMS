import { DEGRADATION_DRIFT_TARGETS } from "@bms/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Pool } from "pg";

import type { BmsTx } from "../database/tenant-context";
import { textArray } from "../ml/ml-findings.reads";
import { uuidArray } from "../ml/ml-forecasts.reads";
import { aggregateRelation, avgExpr } from "../telemetry/point-aggregates";
import type { CounterDay, MeanDay, ScheduleInput } from "./degradation-engine.types";

/**
 * `E1.5a` / ADR 0138 (plan T1.8, R-c, R-k, R-o) — the degradation module's own
 * SQL: four statements, every value a bound parameter, every column aliased,
 * and nothing written. Everything else the module reads is an existing read,
 * reused unchanged (`readThresholdRules`, `healthForAssets`, `scoresInScope`).
 *
 * - **Candidates** and **schedules** run on the `tx` `withReadScope` hands them:
 *   on the tenant branch row security scopes the tables; on the fleet branch
 *   (a global admin, or a caller whose assets span organizations) the
 *   `= ANY(ids)` line is the control. The candidate filter is chosen by
 *   `ids === null`, never by the branch.
 * - **"Real"** is the ML scorer's own line, word for word
 *   (`apps/ml/src/bms_ml/db/sql.py`, `advisories.reads.ts`;
 *   `tests/e1.5-degradation-containment.test.ts` holds the text equal), on the
 *   asset's `EXISTS` and again on each drift point (R-k).
 * - **The counters and the hourly means** run on the fleet pool with the
 *   considered ids only, never `null`; the bound `unnest` list is their
 *   isolation control. Days are grouped in SQL by the local day of each
 *   asset's bound zone (R-c), so at most one row per series and day comes back.
 */

/** One candidate row, every column aliased. */
export type DegradationCandidateDbRow = {
  asset_id: string;
  organization_id: string;
  location_id: string;
  asset_code: string;
  asset_name: string;
  asset_rtu_name: string | null;
  location_name: string;
  location_zone: string | null;
  organization_zone: string | null;
  /** The asset's drift points (R-k): active, real themselves, of a target class. */
  drift_points: { point_key: string; unit: string | null }[] | null;
};

/** One drift point of a candidate. */
export interface CandidateDriftPoint {
  readonly pointKey: string;
  readonly unit: string | null;
}

/**
 * The assets among `ids` (`null`: every asset the transaction can see) that
 * are active and have an active point passing the real line, with their
 * labels, both zones, and their drift points: active points of a target class
 * (`DEGRADATION_DRIFT_TARGETS`, bound as three arrays) that pass the real
 * line themselves.
 */
export function degradationCandidatesStatement(ids: readonly string[] | null): SQL {
  const domains = textArray(DEGRADATION_DRIFT_TARGETS.map((target) => target.domain));
  const assetTypes = textArray(DEGRADATION_DRIFT_TARGETS.map((target) => target.assetType));
  const pointKeys = textArray(DEGRADATION_DRIFT_TARGETS.map((target) => target.pointKey));
  const assetFilter = ids === null ? sql`` : sql`AND a.id = ANY(${uuidArray(ids)}::uuid[])`;
  return sql`
    SELECT a.id AS asset_id, a.organization_id AS organization_id, a.location_id AS location_id,
           a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.name AS location_name, l.timezone AS location_zone, o.timezone AS organization_zone,
           dp.drift_points AS drift_points
      FROM bms.assets a
      JOIN bms.locations l ON l.id = a.location_id
      JOIN bms.organizations o ON o.id = a.organization_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
      LEFT JOIN bms.asset_templates t ON t.id = a.template_id
      LEFT JOIN LATERAL (
        SELECT coalesce(
                 json_agg(json_build_object('point_key', ap.point_key, 'unit', ap.unit) ORDER BY ap.point_key),
                 '[]'::json
               ) AS drift_points
          FROM bms.asset_points ap
          LEFT JOIN bms.rtus r ON r.id = ap.rtu_id
          JOIN unnest(${domains}::text[], ${assetTypes}::text[], ${pointKeys}::text[]) AS tg(domain, asset_type, point_key)
            ON tg.domain = a.domain AND tg.asset_type = t.asset_type AND tg.point_key = ap.point_key
         WHERE ap.asset_id = a.id
           AND ap.active
           AND (a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled))
      ) dp ON true
     WHERE a.active
       AND EXISTS (
             SELECT 1
               FROM bms.asset_points ap
               LEFT JOIN bms.rtus r ON r.id = ap.rtu_id
              WHERE ap.asset_id = a.id
                AND ap.active
                AND (a.meta->>'telemetrySource' = 'mqtt' OR (ap.source_kind = 'measured' AND r.ingest_enabled))
           )
       ${assetFilter}
     ORDER BY a.id`;
}

/** Runs {@link degradationCandidatesStatement} on the `tx` `withReadScope` hands it. */
export async function readDegradationCandidates(tx: BmsTx, ids: readonly string[] | null): Promise<DegradationCandidateDbRow[]> {
  const result = await tx.execute<DegradationCandidateDbRow>(degradationCandidatesStatement(ids));
  return result.rows;
}

/** A candidate row's drift points; none when the lateral listed none. */
export function driftPointsOf(row: DegradationCandidateDbRow): CandidateDriftPoint[] {
  return (row.drift_points ?? []).map((point) => ({ pointKey: point.point_key, unit: point.unit }));
}

/**
 * The active maintenance schedules of `ids` (plan §4.7): the asset is the task
 * template's, and the organization is held equal on both joins. By asset, due
 * date, then id.
 */
export function activeSchedulesStatement(ids: readonly string[]): SQL {
  return sql`
    SELECT s.id AS schedule_id, t.asset_id AS asset_id,
           (extract(epoch FROM s.next_due_at) * 1000)::float8 AS next_due_ms
      FROM bms.maintenance_schedules s
      JOIN bms.maintenance_task_templates t ON t.id = s.template_id AND t.organization_id = s.organization_id
      JOIN bms.assets a ON a.id = t.asset_id AND a.organization_id = s.organization_id
     WHERE s.active AND t.asset_id = ANY(${uuidArray(ids)}::uuid[])
     ORDER BY t.asset_id, s.next_due_at, s.id`;
}

/** Runs {@link activeSchedulesStatement} on `tx`; no id reads nothing. */
export async function readActiveSchedules(tx: BmsTx, ids: readonly string[]): Promise<ScheduleInput[]> {
  if (ids.length === 0) return [];
  const result = await tx.execute<{ schedule_id: string; asset_id: string; next_due_ms: number | string }>(
    activeSchedulesStatement(ids),
  );
  return result.rows.map((row) => ({ scheduleId: row.schedule_id, assetId: row.asset_id, nextDueMs: Number(row.next_due_ms) }));
}

/** One counter day of one asset. */
export interface AssetCounterDay extends CounterDay {
  readonly assetId: string;
}

/** One mean day of one asset's point. */
export interface AssetMeanDay extends MeanDay {
  readonly assetId: string;
  readonly pointKey: string;
}

function relationOf(level: "1h"): string {
  const relation = aggregateRelation(level);
  if (!relation) throw new Error(`degradation read: no ${level} aggregate relation`);
  return relation;
}

/**
 * Each tag's counters per local day over `[fromMs, toMs)` (plan §4.5):
 * Σ`in_range_count`, Σ`sample_count`, max `rule_count`, max
 * `skipped_rule_count` — the live read's own rule. `pool` is the fleet pool.
 */
export async function readCounterDays(
  pool: Pick<Pool, "query">,
  assets: readonly { readonly assetId: string; readonly zone: string }[],
  fromMs: number,
  toMs: number,
): Promise<AssetCounterDay[]> {
  if (assets.length === 0) return [];
  const { rows } = await pool.query<{
    asset_id: string;
    point_key: string;
    day: string;
    in_range_count: number | string;
    sample_count: number | string;
    rule_count: number | string;
    skipped_rule_count: number | string;
  }>(
    `SELECT c.asset_id AS asset_id, c.point_key AS point_key,
            to_char((c.bucket AT TIME ZONE z.zone)::date, 'YYYY-MM-DD') AS day,
            sum(c.in_range_count)::float8 AS in_range_count, sum(c.sample_count)::float8 AS sample_count,
            max(c.rule_count)::int AS rule_count, max(c.skipped_rule_count)::int AS skipped_rule_count
       FROM telemetry.point_in_range_1h c
       JOIN unnest($1::uuid[], $2::text[]) AS z(asset_id, zone) ON z.asset_id = c.asset_id
      WHERE c.bucket >= $3 AND c.bucket < $4
      GROUP BY c.asset_id, c.point_key, (c.bucket AT TIME ZONE z.zone)::date`,
    [assets.map((a) => a.assetId), assets.map((a) => a.zone), new Date(fromMs), new Date(toMs)],
  );
  return rows.map((row) => ({
    assetId: row.asset_id,
    pointKey: row.point_key,
    day: row.day,
    inRangeCount: Number(row.in_range_count),
    sampleCount: Number(row.sample_count),
    ruleCount: Number(row.rule_count),
    skippedRuleCount: Number(row.skipped_rule_count),
  }));
}

/**
 * Each point's mean per local day over `[fromMs, toMs)` from the `_1h`
 * aggregate (plan §4.6): `avgExpr`, the sample-weighted mean, and
 * Σ`sample_count` beside it. A day with no sample is not returned. `pool` is
 * the fleet pool.
 */
export async function readMeanDays(
  pool: Pick<Pool, "query">,
  points: readonly { readonly assetId: string; readonly pointKey: string; readonly zone: string }[],
  fromMs: number,
  toMs: number,
): Promise<AssetMeanDay[]> {
  if (points.length === 0) return [];
  const { rows } = await pool.query<{
    asset_id: string;
    point_key: string;
    day: string;
    mean: number | string | null;
    sample_count: number | string;
  }>(
    `SELECT v.asset_id AS asset_id, v.point_key AS point_key,
            to_char((v.bucket AT TIME ZONE z.zone)::date, 'YYYY-MM-DD') AS day,
            (${avgExpr("v")})::float8 AS mean, sum(v.sample_count)::float8 AS sample_count
       FROM ${relationOf("1h")} v
       JOIN unnest($1::uuid[], $2::text[], $3::text[]) AS z(asset_id, point_key, zone)
         ON z.asset_id = v.asset_id AND z.point_key = v.point_key
      WHERE v.bucket >= $4 AND v.bucket < $5
      GROUP BY v.asset_id, v.point_key, (v.bucket AT TIME ZONE z.zone)::date
     HAVING sum(v.sample_count) > 0`,
    [points.map((p) => p.assetId), points.map((p) => p.pointKey), points.map((p) => p.zone), new Date(fromMs), new Date(toMs)],
  );
  return rows.map((row) => ({
    assetId: row.asset_id,
    pointKey: row.point_key,
    day: row.day,
    mean: row.mean === null ? null : Number(row.mean),
    sampleCount: Number(row.sample_count),
  }));
}
