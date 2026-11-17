import { sql, type SQL } from "drizzle-orm";

import { ANOMALY_DETECTORS, ANOMALY_UNUSUAL_SCORE, TERMINAL_WORK_ORDER_STATUSES } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import { currentAnomalyScoresCte } from "../ml/ml-anomalies.reads";
import { uuidArray } from "../ml/ml-forecasts.reads";
import type { AnomalyHealthHoursDbRow, AssetLabelDbRow, OpenCorrectiveDbRow } from "./health-inputs.pure";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.5, R-a) — the health inputs SQL.
 *
 * **Every function takes the `tx` that `withReadScope` hands it, and nothing
 * else.** On the tenant branch the transaction carries the
 * `app.current_organization` GUC, so the row policies scope every `ml` and
 * `bms` row read here; on the fleet branch (`bms_fleet`, `BYPASSRLS`) the ids
 * are the control: the anomaly read's `asset_id = ANY(ids)` line (the imported
 * chain's, present whenever `ids` is not `null`), the ticket read's one asset
 * id and the label read's `ANY(ids)`.
 *
 * **The scores are reached only through `currentAnomalyScoresCte`, imported
 * from `../ml/ml-anomalies.reads`**, so this file never names the scores
 * table, the newest succeeded run per hour and detector wins before the line
 * applies, and the per-run `LATERAL … OFFSET 0` fence is that file's.
 * `ANOMALY_UNUSUAL_SCORE` and both detector names are bound, never restated.
 *
 * Times cross as epoch milliseconds (`float8`); every value is a bound
 * parameter; every output column is aliased.
 */

const at = (ms: number): SQL => sql`to_timestamp(${ms}::float8 / 1000)`;

/** The Baseline detector (`DETECTOR_BASELINE`) and the Isolation Forest (`DETECTOR_FOREST`). */
const BASELINE_DETECTOR: (typeof ANOMALY_DETECTORS)[0] = ANOMALY_DETECTORS[0];
const FOREST_DETECTOR: (typeof ANOMALY_DETECTORS)[1] = ANOMALY_DETECTORS[1];

/** A ticket in one of these is not open (`openWorkOrderWhere`'s rule in `metric-catalog.service.ts`). */
const CLOSED_STATUSES = `{${["resolved", ...TERMINAL_WORK_ORDER_STATUSES].join(",")}}`;

/**
 * Plan §4.1: one row per scored asset among `ids` (`null` is the unrestricted admin) since
 * `sinceMs`. Per asset and hour: a scored hour has a current row; an unusual hour has any detector
 * at or above the line; a strong hour has both; a Baseline-only hour has the Baseline detector and
 * not the forest. `last_points` are the last unusual hour's contributing points, one list per
 * marking detector in detector order. One statement serves the list and the one-asset route.
 */
export function anomalyHealthHoursStatement(ids: readonly string[] | null, sinceMs: number): SQL {
  return sql`
    ${currentAnomalyScoresCte(ids, sinceMs)}
    , hours AS (
      SELECT asset_id, bucket,
             bool_or(score >= ${ANOMALY_UNUSUAL_SCORE}::float8) AS marked,
             bool_or(score >= ${ANOMALY_UNUSUAL_SCORE}::float8 AND detector = ${BASELINE_DETECTOR}) AS baseline_marked,
             bool_or(score >= ${ANOMALY_UNUSUAL_SCORE}::float8 AND detector = ${FOREST_DETECTOR}) AS forest_marked
        FROM current_scores
       GROUP BY asset_id, bucket
    ), per_asset AS (
      SELECT asset_id,
             count(*) AS scored_hours,
             count(*) FILTER (WHERE marked) AS unusual_hours,
             count(*) FILTER (WHERE baseline_marked AND forest_marked) AS strong_hours,
             count(*) FILTER (WHERE baseline_marked AND NOT forest_marked) AS baseline_only_hours,
             max(bucket) FILTER (WHERE marked) AS last_unusual
        FROM hours
       GROUP BY asset_id
    ), last_rows AS (
      SELECT c.asset_id, jsonb_agg(c.contributing_points ORDER BY c.detector) AS last_points
        FROM current_scores c
        JOIN per_asset p ON p.asset_id = c.asset_id AND p.last_unusual = c.bucket
       WHERE c.score >= ${ANOMALY_UNUSUAL_SCORE}::float8
       GROUP BY c.asset_id
    )
    SELECT p.asset_id AS asset_id, p.scored_hours::int AS scored_hours, p.unusual_hours::int AS unusual_hours,
           p.strong_hours::int AS strong_hours, p.baseline_only_hours::int AS baseline_only_hours,
           (extract(epoch FROM p.last_unusual) * 1000)::float8 AS last_unusual_ms, lr.last_points AS last_points,
           a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.id AS location_id, l.name AS location_name
      FROM per_asset p
      LEFT JOIN last_rows lr ON lr.asset_id = p.asset_id
      JOIN bms.assets a ON a.id = p.asset_id
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
     ORDER BY a.code, p.asset_id`;
}

/** Runs {@link anomalyHealthHoursStatement} on `tx`. */
export async function readAnomalyHealthHours(
  tx: BmsTx,
  ids: readonly string[] | null,
  sinceMs: number,
): Promise<AnomalyHealthHoursDbRow[]> {
  const result = await tx.execute<AnomalyHealthHoursDbRow>(anomalyHealthHoursStatement(ids, sinceMs));
  return result.rows;
}

/**
 * Plan §4.5 (Q1 ruled (a)): the open corrective tickets of one asset — open is not `resolved`,
 * `closed` or `cancelled`; corrective is not linked by any maintenance-schedule record — and how
 * many are past their SLA at `nowMs`, the request's clock. One row, always.
 */
export function openCorrectiveStatement(assetId: string, nowMs: number): SQL {
  return sql`
    SELECT count(*)::int AS open_corrective,
           (count(*) FILTER (WHERE w.sla_minutes IS NOT NULL AND w.sla_due_at IS NOT NULL
                               AND w.sla_due_at < ${at(nowMs)}))::int AS past_sla
      FROM bms.work_orders w
     WHERE w.asset_id = ${assetId}::uuid
       AND w.status <> ALL(${CLOSED_STATUSES}::text[])
       AND NOT EXISTS (SELECT 1 FROM bms.maintenance_history h
                        WHERE h.asset_id = w.asset_id AND h.work_order_id = w.id)`;
}

/** Runs {@link openCorrectiveStatement} on `tx`. */
export async function readOpenCorrective(
  tx: BmsTx,
  assetId: string,
  nowMs: number,
): Promise<OpenCorrectiveDbRow | undefined> {
  const result = await tx.execute<OpenCorrectiveDbRow>(openCorrectiveStatement(assetId, nowMs));
  return result.rows[0];
}

/** The label fields of `ids`, for the *Lowest health score* rows. */
export function assetLabelsStatement(ids: readonly string[]): SQL {
  return sql`
    SELECT a.id AS asset_id, a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.id AS location_id, l.name AS location_name
      FROM bms.assets a
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
     WHERE a.id = ANY(${uuidArray(ids)}::uuid[])`;
}

/** Runs {@link assetLabelsStatement} on `tx`. */
export async function readAssetLabels(tx: BmsTx, ids: readonly string[]): Promise<AssetLabelDbRow[]> {
  const result = await tx.execute<AssetLabelDbRow>(assetLabelsStatement(ids));
  return result.rows;
}
