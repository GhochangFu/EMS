import {
  HEALTH_ANOMALY_WINDOW_DAYS,
  HEALTH_BAD_ACTORS_LIMIT,
  HEALTH_BAD_ACTOR_POINTS,
  HEALTH_INPUTS,
  advisoryHealthScore,
  anomalyFindingHref,
  healthAnomalyPenalty,
  type AssetHealthInputsResponse,
  type HealthAnomalyHistory,
  type HealthBadActor,
  type HealthBadActorsAnomaly,
  type HealthLowestScore,
  type HealthMaintenanceFact,
} from "@bms/shared";

import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import type { HealthScopeScore } from "./asset-health.service";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan §4.1–§4.7, T1.2) — the pure step of the
 * health inputs. No database and no clock: the request's one `now` is passed
 * in. The reads have already taken the newest run per hour and detector and
 * applied `ANOMALY_UNUSUAL_SCORE` (`health-inputs.reads.ts`), so nothing here
 * compares a score with the line.
 *
 * The penalty and the advisory figure are `@bms/shared`'s, so the web's asset
 * card and this list subtract in exactly one place (plan R-b). The two caveat
 * sentences are `E1.9`'s, imported and never copied.
 */

/** One row of the anomaly-hours read: one scored asset in the window, every column aliased. */
export type AnomalyHealthHoursDbRow = {
  asset_id: string;
  scored_hours: number;
  unusual_hours: number;
  strong_hours: number;
  baseline_only_hours: number;
  last_unusual_ms: number | null;
  /** The last unusual hour's contributing points, one list per marking detector, in detector order. */
  last_points: string[][] | null;
  asset_code: string;
  asset_name: string;
  asset_rtu_name: string | null;
  location_id: string;
  location_name: string;
};

/** The maintenance read's one row. */
export type OpenCorrectiveDbRow = { open_corrective: number; past_sla: number };

/** One row of the label read. */
export type AssetLabelDbRow = {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  asset_rtu_name: string | null;
  location_id: string;
  location_name: string;
};

const hoursOf = (row: AnomalyHealthHoursDbRow) => ({
  scoredHours: Number(row.scored_hours),
  unusualHours: Number(row.unusual_hours),
  strongHours: Number(row.strong_hours),
  baselineOnlyHours: Number(row.baseline_only_hours),
});

/** The asset's anomaly history, or `null` with no row or no scored hour (decision 2: absent, never zero). */
export function anomalyHistoryOf(row: AnomalyHealthHoursDbRow | undefined): HealthAnomalyHistory | null {
  if (row === undefined) return null;
  const hours = hoursOf(row);
  const penalty = healthAnomalyPenalty(hours);
  if (penalty === null) return null;
  return { windowDays: HEALTH_ANOMALY_WINDOW_DAYS, ...hours, penalty };
}

/** The maintenance fact, or `null` with no open corrective ticket (plan §4.5: no zero on screen). */
export function maintenanceOf(row: OpenCorrectiveDbRow | undefined): HealthMaintenanceFact | null {
  if (row === undefined) return null;
  const openCorrective = Number(row.open_corrective);
  if (!(openCorrective > 0)) return null;
  return { openCorrective, pastSla: Number(row.past_sla) };
}

/**
 * `GET /asset-health/assets/:assetId/inputs`: the five inputs and the two facts. A failed read
 * reaches here as `undefined`, so it looks exactly like an empty one (decision 9).
 */
export function toInputsResponse(
  assetId: string,
  hoursRow: AnomalyHealthHoursDbRow | undefined,
  maintenanceRow: OpenCorrectiveDbRow | undefined,
  now: Date,
): AssetHealthInputsResponse {
  return {
    assetId,
    asOf: now.toISOString(),
    inputs: HEALTH_INPUTS.map((input) => ({ ...input })),
    anomalyHistory: anomalyHistoryOf(hoursRow?.asset_id === assetId ? hoursRow : undefined),
    maintenance: maintenanceOf(maintenanceRow),
  };
}

/** The last unusual hour's points, the detectors' lists joined in detector order, no repeats. */
export function topPointsOf(lastPoints: readonly (readonly string[] | null)[] | null): string[] {
  const points: string[] = [];
  for (const list of lastPoints ?? []) {
    for (const key of list ?? []) if (!points.includes(key)) points.push(key);
  }
  return points;
}

/** Plain UTF-16 code-unit order, locale-independent. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Plan §4.6: the assets with an unusual hour, strong hours descending, then Baseline-only hours
 * descending, then asset code, then asset id. Every listed asset; the cut is the caller's.
 */
export function rankBadActors(rows: readonly AnomalyHealthHoursDbRow[]): AnomalyHealthHoursDbRow[] {
  return rows
    .filter((row) => Number(row.unusual_hours) > 0)
    .sort(
      (a, b) =>
        Number(b.strong_hours) - Number(a.strong_hours) ||
        Number(b.baseline_only_hours) - Number(a.baseline_only_hours) ||
        byCodeUnit(a.asset_code, b.asset_code) ||
        byCodeUnit(a.asset_id, b.asset_id),
    );
}

/** The asset loses points: it has a rule score and an advisory figure below it (plan §4.2). */
function losesPoints(row: AnomalyHealthHoursDbRow, ruleScore: number | null): boolean {
  const advisory = advisoryHealthScore(ruleScore, healthAnomalyPenalty(hoursOf(row)));
  return ruleScore !== null && advisory !== null && advisory < ruleScore;
}

function badActorOf(row: AnomalyHealthHoursDbRow, ruleScore: number | null, nowMs: number): HealthBadActor {
  const hours = hoursOf(row);
  const lastMs = Number(row.last_unusual_ms);
  const points = topPointsOf(row.last_points);
  return {
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    assetRtuName: row.asset_rtu_name,
    locationId: row.location_id,
    assetLocationName: row.location_name,
    ...hours,
    weak: hours.strongHours === 0 && hours.baselineOnlyHours === hours.unusualHours,
    lastUnusualAt: new Date(lastMs).toISOString(),
    topPoints: points.slice(0, HEALTH_BAD_ACTOR_POINTS),
    href: anomalyFindingHref(row.asset_id, lastMs, nowMs, points),
    ruleScore,
    advisoryScore: advisoryHealthScore(ruleScore, healthAnomalyPenalty(hours)),
  };
}

/**
 * The anomaly half of `GET /asset-health/bad-actors` (plan §4.6) from every scored asset in scope:
 * the top `HEALTH_BAD_ACTORS_LIMIT`, how many were unusual before the cut, how many of ALL rows
 * lose points, and the caveat over every unusual hour in scope.
 */
export function toBadActorsAnomaly(
  rows: readonly AnomalyHealthHoursDbRow[],
  scoreById: ReadonlyMap<string, number | null>,
  now: Date,
): HealthBadActorsAnomaly {
  const ranked = rankBadActors(rows);
  const scoreOf = (id: string): number | null => scoreById.get(id) ?? null;
  const unusual = ranked.reduce((sum, row) => sum + Number(row.unusual_hours), 0);
  const baselineOnly = ranked.reduce((sum, row) => sum + Number(row.baseline_only_hours), 0);
  return {
    windowDays: HEALTH_ANOMALY_WINDOW_DAYS,
    unusualAssetCount: ranked.length,
    losingAssetCount: rows.filter((row) => losesPoints(row, scoreOf(row.asset_id))).length,
    caveat: unusual === 0 ? null : baselineOnly === unusual ? BASELINE_ONLY_SENTENCE : MIXED_SENTENCE,
    items: ranked.slice(0, HEALTH_BAD_ACTORS_LIMIT).map((row) => badActorOf(row, scoreOf(row.asset_id), now.getTime())),
  };
}

const scoredOnly = (scored: readonly HealthScopeScore[]): (HealthScopeScore & { score: number })[] =>
  scored.filter((entry): entry is HealthScopeScore & { score: number } => entry.score !== null);

/** Plan §4.7: the ids of the `HEALTH_BAD_ACTORS_LIMIT` lowest rule scores, ascending, ties by asset id. */
export function lowestIdsOf(scored: readonly HealthScopeScore[]): string[] {
  return scoredOnly(scored)
    .sort((a, b) => a.score - b.score || byCodeUnit(a.assetId, b.assetId))
    .slice(0, HEALTH_BAD_ACTORS_LIMIT)
    .map((entry) => entry.assetId);
}

/** The *Lowest health score* rows: `lowestIdsOf`'s assets with their labels. One with no label read is left out. */
export function lowestScoresOf(
  scored: readonly HealthScopeScore[],
  labelsById: ReadonlyMap<string, AssetLabelDbRow>,
): HealthLowestScore[] {
  const byId = new Map(scoredOnly(scored).map((entry) => [entry.assetId, entry]));
  const rows: HealthLowestScore[] = [];
  for (const id of lowestIdsOf(scored)) {
    const entry = byId.get(id);
    const label = labelsById.get(id);
    if (entry === undefined || label === undefined) continue;
    rows.push({
      assetId: id,
      assetCode: label.asset_code,
      assetName: label.asset_name,
      assetRtuName: label.asset_rtu_name,
      locationId: label.location_id,
      assetLocationName: label.location_name,
      score: entry.score,
      band: entry.band,
      scoredTagCount: entry.scoredTagCount,
    });
  }
  return rows;
}
