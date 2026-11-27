import {
  ADVISORY_MIN_COVERAGE,
  ADVISORY_PROJECTION_DAYS,
  ADVISORY_WINDOW_DAYS,
  BASELINE_WINDOWS,
  type Advisory,
  type AdvisoryAmount,
  type AdvisoryKind,
} from "@bms/shared";

import { parameterRowAt, type ParameterSeriesRow } from "../calc/calc-parameter-series";
import { toInstant } from "../reports/report-period";
import {
  foldCostByDay,
  localDay,
  shiftDay,
  sumCostDays,
  windowDays,
  type HourlyEnergy,
} from "../telemetry/energy-cost-by-day";
import type { AdvisoryAssetInput, AdvisoryCandidate, AdvisoryWindows } from "./advisory-engine.types";

/**
 * `E1.6a` / ADR 0137 (plan R-a, R-b, R-h, §4.1, §4.4) — the window and the
 * figures every advisory kind shares. Pure: no database and no clock.
 *
 * The window is the 7 complete local days before today in the asset's zone;
 * baseline window `k` is the same 7 days shifted back `k × 7` days. Hours fall
 * into days with `localDay`, as `foldCostByDay` does.
 */

const HOUR_MS = 3_600_000;

/**
 * The local midnight that starts `day` (`YYYY-MM-DD`) in `zone`, epoch ms.
 * Exported for E1.5a (degradation trends, ADR 0138).
 */
export function midnightOf(day: string, zone: string): number {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return toInstant({ year, month, day: date }, { hour: 0, minute: 0 }, zone).getTime();
}

/** The window, its baseline windows and the read range of `zone` at `nowMs` (plan R-a). */
export function advisoryWindows(nowMs: number, zone: string): AdvisoryWindows {
  const today = localDay(nowMs, zone);
  const lastDay = shiftDay(today, -1);
  const days = windowDays(lastDay, ADVISORY_WINDOW_DAYS);
  const baselineDays = Array.from({ length: BASELINE_WINDOWS }, (_, i) =>
    windowDays(shiftDay(lastDay, -(i + 1) * ADVISORY_WINDOW_DAYS), ADVISORY_WINDOW_DAYS),
  );
  const toMs = midnightOf(today, zone);
  const oldest = baselineDays[BASELINE_WINDOWS - 1]?.[0] ?? days[0]!;
  return {
    zone,
    days,
    baselineDays,
    fromMs: midnightOf(days[0]!, zone),
    toMs,
    readFromMs: midnightOf(oldest, zone),
    readToMs: toMs,
  };
}

/** The kWh and the hourly bucket count of the hours whose local day is in `days`. */
export function windowTotals(
  hours: readonly HourlyEnergy[],
  zone: string,
  days: readonly string[],
): { kwh: number; bucketCount: number } {
  const wanted = new Set(days);
  let kwh = 0;
  let bucketCount = 0;
  for (const hour of hours) {
    if (!Number.isFinite(hour.kwh) || !wanted.has(localDay(hour.bucketMs, zone))) continue;
    kwh += hour.kwh;
    bucketCount += 1;
  }
  return { kwh, bucketCount };
}

/** The window qualifies when it holds at least `ADVISORY_MIN_COVERAGE` of its hourly buckets (plan R-b). */
export function hasCoverage(bucketCount: number): boolean {
  return bucketCount >= ADVISORY_MIN_COVERAGE * 24 * ADVISORY_WINDOW_DAYS;
}

/** A 7-day figure and its 30-day projection (the unrounded figure × 30 ÷ 7), both rounded. */
export function amountOf(window: number): AdvisoryAmount {
  return {
    window: Math.round(window),
    projected: Math.round((window * ADVISORY_PROJECTION_DAYS) / ADVISORY_WINDOW_DAYS),
  };
}

/** The row in force in the window's last hour (plan R-h); `undefined` when none. */
export function rowAtWindowEnd(
  series: readonly ParameterSeriesRow[],
  windows: AdvisoryWindows,
): ParameterSeriesRow | undefined {
  return parameterRowAt(series, windows.toMs - HOUR_MS);
}

/** What one asset's window holds: its kWh, buckets, and cost when every day with energy is priced. */
export interface WindowFacts {
  readonly kwh: number;
  readonly bucketCount: number;
  /** `C` of plan §4.1, unrounded beyond the daily 2 decimals; `null` when a day is unpriced. */
  readonly cost: number | null;
}

/** `E`, the bucket count and `C` of plan §4.1 for one asset. */
export function windowFacts(input: AdvisoryAssetInput, windows: AdvisoryWindows): WindowFacts {
  const { candidate } = input;
  const totals = windowTotals(input.hours, candidate.zone, windows.days);
  const rows = foldCostByDay(
    [{ assetId: candidate.assetId, zone: candidate.zone, currency: candidate.currency }],
    input.hours.filter((hour) => hour.assetId === candidate.assetId),
    new Map([[candidate.assetId, input.series.rate]]),
    windows.days,
  );
  const unpriced = rows.some((row) => row.reason !== null && row.reason !== "no_energy");
  const total = sumCostDays(rows);
  const cost = unpriced || total.value === null ? null : total.value;
  return { kwh: totals.kwh, bucketCount: totals.bucketCount, cost };
}

/** The identity and window fields of an advisory, before its figures and sentences. */
export function advisoryIdentity(
  candidate: AdvisoryCandidate,
  windows: AdvisoryWindows,
  kind: AdvisoryKind,
): Pick<
  Advisory,
  | "id"
  | "kind"
  | "organizationId"
  | "locationId"
  | "assetId"
  | "assetCode"
  | "assetName"
  | "assetRtuName"
  | "assetLocationName"
  | "timeZone"
  | "windowFrom"
  | "windowTo"
  | "currency"
  | "context"
> {
  return {
    id: `${candidate.assetId}:${kind}`,
    kind,
    organizationId: candidate.organizationId,
    locationId: candidate.locationId,
    assetId: candidate.assetId,
    assetCode: candidate.assetCode,
    assetName: candidate.assetName,
    assetRtuName: candidate.assetRtuName,
    assetLocationName: candidate.assetLocationName,
    timeZone: candidate.timeZone,
    windowFrom: new Date(windows.fromMs).toISOString(),
    windowTo: new Date(windows.toMs).toISOString(),
    currency: candidate.currency,
    context: [],
  };
}
