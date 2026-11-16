import { sql, type SQL } from "drizzle-orm";

import { ANOMALY_LIST_MAX_ROWS, ANOMALY_MODEL_NAME, ANOMALY_UNUSUAL_SCORE } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import type { AnomalyListDbRow, AssetAnomalyDbRow } from "./ml-anomalies.pure";
import { uuidArray } from "./ml-forecasts.reads";

/**
 * `E1.2b` / ADR 0135 Amendment 5 A-e (Amendment 3 S1, S3, S4; plan R12, R13,
 * section 2.4) — the anomaly SQL. The only file under `apps/api/src/ml/` that
 * names the scores table besides its siblings `ml-anomalies.*`
 * (`tests/e1.4a-ml-read-containment.test.ts`).
 *
 * **Every function takes the `tx` that `withReadScope` hands it, and nothing
 * else.** On the tenant branch that transaction carries the
 * `app.current_organization` GUC, so `0157`'s `tenant_isolation` policy scopes
 * every `ml` row read here; on the fleet branch (`bms_fleet`, `BYPASSRLS`) the
 * list's `asset_id = ANY(ids)` line is the only isolation control. That line is
 * present whenever `ids` is not `null`, on **both** branches (S1), and is chosen
 * by `ids !== null`, never by the branch. The one-asset read binds its asset by
 * equality, after the controller's `canReadAsset` (S4).
 *
 * **"Newest run wins", then the threshold (R12).** Both reads take the newest
 * succeeded run per `(asset, hour, detector)` first. The list applies
 * `score >= ANOMALY_UNUSUAL_SCORE` only after that pick, so a re-run that lowers
 * a score removes the mark; inside the lateral it would let an older run's high
 * score survive its own re-run.
 *
 * **No run field is selected (S3, R11)** beyond the run's id, status, name and
 * start, which never leave this file. Times leave as epoch milliseconds
 * (`float8`); every value is a bound parameter; every output column is aliased.
 *
 * **The list's `LATERAL … OFFSET 0` is load-bearing** (plan section 2.4, the
 * forecast list's R4): per run, the lateral reads `anomaly_scores_model_run_idx`;
 * `OFFSET 0` keeps the planner from flattening it into a join that walks the
 * whole table. `tests/e1.2b-ml-anomaly-containment.test.ts` holds the text.
 */

const at = (ms: number): SQL => sql`to_timestamp(${ms}::float8 / 1000)`;

/**
 * One asset's scores in `[fromHourMs, endMs)`: per hour and detector the newest
 * succeeded run's row, ascending by hour then detector. Served by
 * `anomaly_scores_pkey (asset_id, bucket, detector, model_run_id)`.
 */
export function assetAnomaliesStatement(assetId: string, fromHourMs: number, endMs: number): SQL {
  return sql`
    SELECT DISTINCT ON (s.bucket, s.detector)
           (extract(epoch FROM s.bucket) * 1000)::float8 AS bucket_ms,
           s.detector AS detector, s.score AS score, s.contributing_points AS contributing_points
      FROM ml.anomaly_scores s
      JOIN ml.model_runs r ON r.id = s.model_run_id AND r.organization_id = s.organization_id
                          AND r.status = 'succeeded'
     WHERE s.asset_id = ${assetId}::uuid AND s.bucket >= ${at(fromHourMs)} AND s.bucket < ${at(endMs)}
     ORDER BY s.bucket, s.detector, r.started_at DESC, r.id DESC`;
}

/** Runs {@link assetAnomaliesStatement} on `tx`. */
export async function readAssetAnomalies(
  tx: BmsTx,
  assetId: string,
  fromHourMs: number,
  endMs: number,
): Promise<AssetAnomalyDbRow[]> {
  const result = await tx.execute<AssetAnomalyDbRow>(assetAnomaliesStatement(assetId, fromHourMs, endMs));
  return result.rows;
}

/**
 * The list: every unusual hour at or after `sinceMs` among `ids` (`null` is the
 * unrestricted admin), newest first, at most `ANOMALY_LIST_MAX_ROWS + 1` rows so
 * the caller can tell `truncated`. A run that holds a bucket at or after
 * `sinceMs` started after it (a run's scored hour precedes its start), so
 * `started_at >= sinceMs` loses no row.
 */
export function anomalyListStatement(ids: readonly string[] | null, sinceMs: number): SQL {
  const assetFilter = ids === null ? sql`` : sql`AND s0.asset_id = ANY(${uuidArray(ids)}::uuid[])`;
  return sql`
    WITH recent_runs AS (
      SELECT r.id, r.organization_id, r.started_at
        FROM ml.model_runs r
       WHERE r.status = 'succeeded' AND r.model_name = ${ANOMALY_MODEL_NAME} AND r.started_at >= ${at(sinceMs)}
    ), scored AS (
      SELECT s.asset_id, s.bucket, s.detector, s.score, s.contributing_points, rr.started_at, rr.id AS run_id
        FROM recent_runs rr
       CROSS JOIN LATERAL (
         SELECT s0.asset_id, s0.bucket, s0.detector, s0.score, s0.contributing_points
           FROM ml.anomaly_scores s0
          WHERE s0.model_run_id = rr.id AND s0.organization_id = rr.organization_id
            AND s0.bucket >= ${at(sinceMs)}
            ${assetFilter}
         OFFSET 0
       ) s
    ), current_scores AS (
      SELECT DISTINCT ON (asset_id, bucket, detector) asset_id, bucket, detector, score, contributing_points
        FROM scored
       ORDER BY asset_id, bucket, detector, started_at DESC, run_id DESC
    )
    SELECT c.asset_id AS asset_id, (extract(epoch FROM c.bucket) * 1000)::float8 AS bucket_ms,
           c.detector AS detector, c.score AS score, c.contributing_points AS contributing_points,
           a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.id AS location_id, l.name AS location_name,
           l.timezone AS location_time_zone, o.timezone AS organization_time_zone
      FROM current_scores c
      JOIN bms.assets a ON a.id = c.asset_id
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
      LEFT JOIN bms.organizations o ON o.id = a.organization_id
     WHERE c.score >= ${ANOMALY_UNUSUAL_SCORE}::float8
     ORDER BY c.bucket DESC, l.name, a.code, c.detector
     LIMIT ${ANOMALY_LIST_MAX_ROWS + 1}`;
}

/** Runs {@link anomalyListStatement} on `tx`. */
export async function readAnomalyList(
  tx: BmsTx,
  ids: readonly string[] | null,
  sinceMs: number,
): Promise<AnomalyListDbRow[]> {
  const result = await tx.execute<AnomalyListDbRow>(anomalyListStatement(ids, sinceMs));
  return result.rows;
}
