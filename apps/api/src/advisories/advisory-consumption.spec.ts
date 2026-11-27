import { ANOMALY_UNUSUAL_SCORE, advisorySchema, type Advisory } from "@bms/shared";
import { expect } from "vitest";

import { BASELINE_ONLY_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import { verdictFor } from "../reports/energy-abnormal";
import { baselineHours, FIXTURE_WINDOWS, fixtureInput, seriesRow, windowHours } from "./advisories.fixture";
import { anomalyContextOf, excessConsumptionAdvisory, withAnomalyContext } from "./advisory-consumption";
import type { AdvisoryAssetInput } from "./advisory-engine.types";
import { baselineAssumption, emissionAssumption, excessNoRateLine } from "./advisory-lines";
import { windowTotals } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 (plan §4.3, Q4, Q7, R-d, T1.4) — the consumption above
 * baseline advisory, pure. Assertions live here; `advisory-consumption.test.ts`
 * is the entry point.
 */
const run = (input: AdvisoryAssetInput): Advisory | null => excessConsumptionAdvisory(input, FIXTURE_WINDOWS);
const fired = (input: AdvisoryAssetInput): Advisory => {
  const advisory = run(input);
  expect(advisory).not.toBeNull();
  expect(advisorySchema.safeParse(advisory).success).toBe(true);
  return advisory!;
};

/** A window at `kw` with baseline windows at `history`, and optional series overrides. */
const input = (
  kw: number,
  history: readonly (number | null)[],
  series: Partial<AdvisoryAssetInput["series"]> = {},
): AdvisoryAssetInput => {
  const base = fixtureInput({ hours: [...windowHours(kw), ...baselineHours(history)] });
  return { ...base, series: { ...base.series, ...series } };
};

/** An asset-scope baseline of 1,000 kWh/day and 10,500 kWh: ratio 1.5 fires (`>=`), measured. */
export function anAssetBaselineFiresAtTheRatio(): void {
  // 62.5 kW × 168 h = 10,500 kWh; the baseline is 7,000.
  const advisory = fired(input(62.5, [], { baseline: [seriesRow(1000, 0)] }));
  expect(advisory.kind).toBe("excess_consumption");
  expect(advisory.confidence).toBe("measured");
  expect(advisory.kwh).toEqual({ window: 3500, projected: 15000 });
  expect(advisory.headline).toBe("Used 10,500 kWh in the last 7 days, 1.5 times your baseline of 7,000 kWh.");
  expect(advisory.assumptions).toContain(baselineAssumption({ source: "parameter", perDay: 1000 }, "INR"));
  expect(advisory.powerFactor).toBeNull();
  expect(advisory.kvah).toBeNull();
  expect(advisory.kvar).toBeNull();
}

/** 10,499 kWh against 7,000 is under the ratio: none. */
export function justUnderTheRatioIsNone(): void {
  expect(run(input(10499 / 168, [], { baseline: [seriesRow(1000, 0)] }))).toBeNull();
}

/** A location-scope baseline row is ignored (Q7): own history decides. */
export function aLocationBaselineIsIgnored(): void {
  // At 500 kWh/day the location row would make 8,400 kWh 2.4 times the baseline; history says normal.
  expect(run(input(50, [40, 40, 40, 40], { baseline: [seriesRow(500, 1)] }))).toBeNull();
  const advisory = fired(input(60, [40, 40, 40, 40], { baseline: [seriesRow(500, 1)] }));
  expect(advisory.confidence).toBe("estimated");
  expect(advisory.assumptions).toContain(baselineAssumption({ source: "history", windows: 4 }, "INR"));
}

/** Own history: the median of 4 windows. */
export function ownHistoryIsTheMedianOfFourWindows(): void {
  // Windows of 6,720, 6,888, 6,552 and 8,400 kWh: median 6,804; 61 kW × 168 = 10,248 ≥ 1.5 × 6,804.
  const advisory = fired(input(61, [40, 41, 39, 50]));
  expect(advisory.kwh?.window).toBe(10248 - 6804);
  expect(advisory.headline).toBe("Used 10,248 kWh in the last 7 days, 1.51 times its usual 6,804 kWh.");
  expect(advisory.confidence).toBe("estimated");
}

/** Two counting windows are not enough history; a zero baseline never fires. */
export function shortOrZeroHistoryIsNone(): void {
  expect(run(input(100, [40, 40, null, null]))).toBeNull();
  expect(run(input(100, [0, 0, 0, 0]))).toBeNull();
}

/** The trigger is `verdictFor`'s, on the same windows, at and around the ratio. */
export function theTriggerIsTheEnergyPagesVerdict(): void {
  for (const [kw, history] of [
    [60, [40, 40, 40, 40]],
    [59.9, [40, 40, 40, 40]],
    [61, [40, 41, 39, 50]],
    [80, [40, 40, 40, null]],
    [80, [40, 40, null, null]],
    [80, [40, 0, 0, 40]],
  ] as const) {
    const fixture = input(kw, history);
    const current = windowTotals(fixture.hours, FIXTURE_WINDOWS.zone, FIXTURE_WINDOWS.days);
    const windows = FIXTURE_WINDOWS.baselineDays.map((days) => windowTotals(fixture.hours, FIXTURE_WINDOWS.zone, days));
    const verdict = verdictFor(current, windows);
    const advisory = run(fixture);
    expect(advisory !== null).toBe(verdict.verdict === "above");
    if (advisory !== null) {
      expect(advisory.kwh?.window).toBe(Math.round(current.kwh - (verdict.baselineKwh as number)));
    }
  }
}

/** Money = excess × C ÷ E; CO₂ = excess × the factor. */
export function theFiguresUseTheAverageRateAndTheFactor(): void {
  const advisory = fired(
    input(62.5, [], { baseline: [seriesRow(1000, 0)], carbonFactor: [seriesRow(0.7, 1_000_000)] }),
  );
  // C = 105,000 for 10,500 kWh at 10: the average rate is 10.
  expect(advisory.money).toEqual({ window: 35000, projected: 150000 });
  expect(advisory.co2Kg).toEqual({ window: 2450, projected: 10500 });
  expect(advisory.lines).toHaveLength(3);
  expect(advisory.lines[1]).toBe("About ₹ 35,000 in 7 days (about ₹ 1,50,000 in 30 days if the last 7 days repeat).");
  expect(advisory.lines[2]).toBe("About 2,450 kg CO₂ in 7 days (about 10,500 kg CO₂ in 30 days if the last 7 days repeat).");
}

/** No cost: no money, kWh and CO₂ still shown. No factor: no CO₂, and the assumption says so. */
export function missingRateOrFactorDropsOnlyThatFigure(): void {
  const noRate = fired(
    input(62.5, [], { rate: [], baseline: [seriesRow(1000, 0)], carbonFactor: [seriesRow(0.7, 0)] }),
  );
  expect(noRate.money).toBeNull();
  expect(noRate.lines).toContain(excessNoRateLine("INR"));
  expect(noRate.kwh).not.toBeNull();
  expect(noRate.co2Kg).not.toBeNull();

  const noFactor = fired(input(62.5, [], { baseline: [seriesRow(1000, 0)] }));
  expect(noFactor.co2Kg).toBeNull();
  expect(noFactor.assumptions).toContain(emissionAssumption(undefined, "Asia/Kolkata"));
  expect(noFactor.lines).toHaveLength(2);
}

/** The context changes no number: with and without, deep-equal apart from `context`. */
export function theContextChangesNoNumber(): void {
  const advisory = fired(input(62.5, [], { baseline: [seriesRow(1000, 0)] }));
  const withContext = withAnomalyContext(advisory, { unusualHours: 3, bothHours: 0, baselineOnlyHours: 3 });
  expect(withContext.context).toEqual([
    "3 unusual hours in this window on the Anomalies page (advisory); 0 marked by both methods.",
    BASELINE_ONLY_SENTENCE,
  ]);
  expect({ ...withContext, context: [] }).toEqual(advisory);
  expect(advisorySchema.safeParse(withContext).success).toBe(true);
  // No unusual hour: no line, the advisory unchanged.
  expect(withAnomalyContext(advisory, { unusualHours: 0, bothHours: 0, baselineOnlyHours: 0 })).toEqual(advisory);
}

/** Unusual hours are distinct hours inside the window with any score at or above the line. */
export function theAnomalyCountsAreDistinctWindowHours(): void {
  const at = (offsetHours: number): string => new Date(FIXTURE_WINDOWS.fromMs + offsetHours * 3_600_000).toISOString();
  const context = anomalyContextOf(
    [
      { t: at(1), detector: "baseline_mad", score: ANOMALY_UNUSUAL_SCORE },
      { t: at(1), detector: "isolation_forest", score: 1 },
      { t: at(2), detector: "baseline_mad", score: 1 },
      { t: at(3), detector: "isolation_forest", score: 1 },
      { t: at(4), detector: "baseline_mad", score: ANOMALY_UNUSUAL_SCORE - 0.01 },
      { t: at(-1), detector: "baseline_mad", score: 1 },
      { t: at(168), detector: "baseline_mad", score: 1 },
    ],
    FIXTURE_WINDOWS,
  );
  expect(context).toEqual({ unusualHours: 3, bothHours: 1, baselineOnlyHours: 1 });
}
