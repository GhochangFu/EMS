import { ANOMALY_DETECTORS, ANOMALY_UNUSUAL_SCORE, BASELINE_WINDOWS, type Advisory } from "@bms/shared";

import { verdictFor } from "../reports/energy-abnormal";
import type { AdvisoryAnomalyContext, AdvisoryAssetInput, AdvisoryWindows } from "./advisory-engine.types";
import {
  baselineAssumption,
  co2Line,
  contextLines,
  emissionAssumption,
  excessHeadline,
  excessKwhLine,
  excessNoRateLine,
  moneyLine,
  NOT_BILLING_METER_ASSUMPTION,
  PROJECTION_ASSUMPTION,
  rateAssumption,
  windowAssumption,
} from "./advisory-lines";
import { advisoryIdentity, amountOf, hasCoverage, rowAtWindowEnd, windowFacts, windowTotals } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 decision 2 (plan §4.3, Q4, Q7, R-d, R-h, R-i) — the
 * consumption above baseline advisory of one asset. Pure: no database, no
 * clock.
 *
 * The baseline is the asset-scope `energy_baseline_kwh_per_day` row × 7 when
 * one is in force at the window's end (a site or organization row is ignored,
 * Q7); otherwise the 4 earlier 7-day windows. Either way the trigger is the
 * Energy page's own `verdictFor` (Q4: `>=`, with its counting rule), called and
 * never copied, so the page and the advisory cannot disagree.
 */

const ASSET_RANK = 0;

/** The `excess_consumption` advisory of one asset, or `null` when it does not fire. */
export function excessConsumptionAdvisory(input: AdvisoryAssetInput, windows: AdvisoryWindows): Advisory | null {
  const { candidate, tariff, series } = input;
  const facts = windowFacts(input, windows);
  if (!hasCoverage(facts.bucketCount)) return null;
  const current = { kwh: facts.kwh, bucketCount: facts.bucketCount };

  const assetRow = rowAtWindowEnd(
    series.baseline.filter((row) => row.rank === ASSET_RANK),
    windows,
  );
  const perDay = assetRow !== undefined && Number.isFinite(assetRow.value) && assetRow.value > 0 ? assetRow.value : null;
  // The parameter's 7-day baseline stands in for every earlier window, so the
  // one rule decides both baselines: the median is the baseline itself.
  const earlier =
    perDay !== null
      ? Array.from({ length: BASELINE_WINDOWS }, () => ({ kwh: perDay * windows.days.length, bucketCount: current.bucketCount }))
      : windows.baselineDays.map((days) => windowTotals(input.hours, candidate.zone, days));
  const verdict = verdictFor(current, earlier);
  if (verdict.verdict !== "above" || verdict.baselineKwh === null || verdict.ratio === null) return null;

  const excess = facts.kwh - verdict.baselineKwh;
  const money = facts.cost !== null && facts.kwh > 0 ? amountOf((excess * facts.cost) / facts.kwh) : null;
  const factorRow = rowAtWindowEnd(series.carbonFactor, windows);
  const factor = factorRow !== undefined && Number.isFinite(factorRow.value) ? factorRow : undefined;
  const co2Kg = factor !== undefined ? amountOf(excess * factor.value) : null;
  const notBillingMeter = money !== null && tariff !== null && !tariff.billingMeter;
  const measured = perDay !== null && !notBillingMeter;
  const kwh = amountOf(excess);

  const { currency } = candidate;
  return {
    ...advisoryIdentity(candidate, windows, "excess_consumption"),
    confidence: measured ? "measured" : "estimated",
    headline: excessHeadline(
      facts.kwh,
      verdict.ratio,
      verdict.baselineKwh,
      perDay !== null ? "parameter" : "history",
      currency,
    ),
    lines: [
      excessKwhLine(kwh, currency),
      money !== null ? moneyLine(money, currency) : excessNoRateLine(currency),
      ...(co2Kg !== null ? [co2Line(co2Kg, currency)] : []),
    ],
    assumptions: [
      windowAssumption(windows.days, candidate.timeZone),
      rateAssumption(rowAtWindowEnd(series.rate, windows), tariff, candidate.zone),
      emissionAssumption(factor, candidate.zone),
      baselineAssumption(
        perDay !== null ? { source: "parameter", perDay } : { source: "history", windows: verdict.baselineWindows },
        currency,
      ),
      ...(notBillingMeter ? [NOT_BILLING_METER_ASSUMPTION] : []),
      PROJECTION_ASSUMPTION,
    ],
    money,
    kwh,
    kvah: null,
    co2Kg,
    kvar: null,
    powerFactor: null,
  };
}

const [BASELINE_DETECTOR] = ANOMALY_DETECTORS;

/**
 * The anomaly counts of the window (plan R-d) from one asset's scores
 * (`MlAnomaliesService.forAsset`): distinct hours in `[fromMs, toMs)` with any
 * score at or above `ANOMALY_UNUSUAL_SCORE`.
 */
export function anomalyContextOf(
  scores: readonly { readonly t: string; readonly detector: string; readonly score: number }[],
  windows: AdvisoryWindows,
): AdvisoryAnomalyContext {
  const byHour = new Map<number, Set<string>>();
  for (const score of scores) {
    const tMs = Date.parse(score.t);
    if (!(tMs >= windows.fromMs && tMs < windows.toMs) || !(score.score >= ANOMALY_UNUSUAL_SCORE)) continue;
    const detectors = byHour.get(tMs) ?? new Set<string>();
    detectors.add(score.detector);
    byHour.set(tMs, detectors);
  }
  let bothHours = 0;
  let baselineOnlyHours = 0;
  for (const detectors of byHour.values()) {
    if (detectors.size >= 2) bothHours += 1;
    else if (detectors.has(BASELINE_DETECTOR)) baselineOnlyHours += 1;
  }
  return { unusualHours: byHour.size, bothHours, baselineOnlyHours };
}

/** The advisory with its context lines; every number is left as it was. */
export function withAnomalyContext(advisory: Advisory, context: AdvisoryAnomalyContext): Advisory {
  const lines = contextLines(context);
  return lines.length === 0 ? advisory : { ...advisory, context: lines };
}
