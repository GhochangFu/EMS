import { ADVISORY_DISCLAIMER } from "@bms/shared";
import { expect } from "vitest";

import { ORGANIZATION_RANK } from "../calc/calc-parameter-series";
import { BASELINE_ONLY_SENTENCE, MIXED_SENTENCE } from "../ml/ml-findings.anomaly-facts";
import {
  baselineAssumption,
  co2Line,
  contextLines,
  emissionAssumption,
  excessHeadline,
  excessKwhLine,
  excessNoRateLine,
  formatMoney,
  kvarLine,
  moneyLine,
  NOT_BILLING_METER_ASSUMPTION,
  pfAvoidableLine,
  pfHeadline,
  pfNoMoneyLine,
  pfSourceAssumption,
  PROJECTION_ASSUMPTION,
  rateAssumption,
  scopeWord,
  TARGET_PF_ASSUMPTION,
  thresholdAssumption,
  windowAssumption,
} from "./advisory-lines";

/**
 * `E1.6a` / ADR 0137 (plan §4.4, R-j, R-k, T1.5) — every sentence an advisory
 * carries, as an exact string. Assertions live here; `advisory-lines.test.ts`
 * is the vitest entry point. Made-up names only.
 */
const KOLKATA = "Asia/Kolkata";
const ms = (iso: string): number => Date.parse(iso);

/** The power-factor headline and lines. */
export function thePowerFactorSentencesAreExact(): void {
  expect(pfHeadline(0.87, 0.95)).toBe("Power factor averaged 0.87 over the last 7 days, below 0.95.");
  expect(pfAvoidableLine({ window: 1212, projected: 5195 }, "INR")).toBe(
    "About 1,212 kVAh could be avoided at a power factor of 0.99 (about 5,195 kVAh in 30 days if the last 7 days repeat).",
  );
  expect(moneyLine({ window: 12340, projected: 52886 }, "INR")).toBe(
    "About ₹ 12,340 in 7 days (about ₹ 52,886 in 30 days if the last 7 days repeat).",
  );
  expect(pfNoMoneyLine("kwh_tariff", "INR")).toBe(
    "Your tariff bills kWh; a PF penalty is not modelled, so no ₹ is shown.",
  );
  expect(pfNoMoneyLine("no_tariff", "INR")).toBe(
    "No kVAh-billed tariff is set for this meter's site, so no ₹ is shown.",
  );
  expect(pfNoMoneyLine("no_rate", "INR")).toBe("No rate is available for this meter, so no ₹ is shown.");
  expect(kvarLine(21, "INR")).toBe("About 21 kVAr of correction would bring it to 0.99.");
}

/** A band set to 3 decimals prints as set, so the headline never reads "0.93 …, below 0.93". */
export function aThreeDecimalBandNeverPrintsEqualToThePf(): void {
  expect(pfHeadline(0.928, 0.932)).toBe("Power factor averaged 0.93 over the last 7 days, below 0.932.");
  // Finer than 3 decimals: more places until the two differ.
  expect(pfHeadline(0.93, 0.9301)).toBe("Power factor averaged 0.93 over the last 7 days, below 0.9301.");
  expect(pfHeadline(0.87, 0.9)).toBe("Power factor averaged 0.87 over the last 7 days, below 0.90.");
  const row = { fromMs: 0, toMs: null, value: 0.932, rank: 0 };
  expect(thresholdAssumption(row)).toBe("Threshold: 0.932 (tariff_pf_band, asset scope).");
}

/** A band outside (0, 1] is set but not used: the assumption says so, not "not set". */
export function anOutOfRangeBandIsNamedAsIgnored(): void {
  const row = { fromMs: 0, toMs: null, value: 1.2, rank: 2 };
  expect(thresholdAssumption(undefined, row)).toBe(
    "Threshold: 0.95 (default; tariff_pf_band at location scope is outside 0–1).",
  );
  expect(thresholdAssumption(undefined, undefined)).toBe("Threshold: 0.95 (default; tariff_pf_band is not set).");
}

/** A mapped month whose bill fails is a NaN row at rank −1: no rate, not the tariff's name. */
export function anUnpricedTariffMonthSaysNoRate(): void {
  const tariff = { name: "Fixture HT kVAh", effectiveFrom: "2026-04-01", energyUnit: "kvah" as const, billingMeter: true };
  expect(rateAssumption({ fromMs: 0, toMs: null, value: Number.NaN, rank: -1 }, tariff, KOLKATA)).toBe("No rate set.");
}

/** The excess headline (both baselines) and lines. */
export function theExcessSentencesAreExact(): void {
  expect(excessHeadline(10500, 1.5, 7000, "parameter", "INR")).toBe(
    "Used 10,500 kWh in the last 7 days, 1.5 times your baseline of 7,000 kWh.",
  );
  expect(excessHeadline(10500, 1.54321, 6804, "history", "INR")).toBe(
    "Used 10,500 kWh in the last 7 days, 1.54 times its usual 6,804 kWh.",
  );
  expect(excessKwhLine({ window: 3500, projected: 15000 }, "INR")).toBe(
    "About 3,500 kWh above the baseline (about 15,000 kWh in 30 days if the last 7 days repeat).",
  );
  expect(excessNoRateLine("INR")).toBe("No rate is set for this meter, so no ₹ is shown.");
  expect(co2Line({ window: 2506, projected: 10740 }, "INR")).toBe(
    "About 2,506 kg CO₂ in 7 days (about 10,740 kg CO₂ in 30 days if the last 7 days repeat).",
  );
}

/** `₹ 12,340` with Indian grouping for INR; the code with US grouping otherwise. */
export function moneyReadsInTheOrganizationsCurrency(): void {
  expect(formatMoney(12340, "INR")).toBe("₹ 12,340");
  expect(formatMoney(1234567, "INR")).toBe("₹ 12,34,567");
  expect(formatMoney(12340, "USD")).toBe("USD 12,340");
  expect(formatMoney(1234567, "USD")).toBe("USD 1,234,567");
  expect(pfNoMoneyLine("kwh_tariff", "USD")).toBe(
    "Your tariff bills kWh; a PF penalty is not modelled, so no USD is shown.",
  );
  expect(excessNoRateLine("USD")).toBe("No rate is set for this meter, so no USD is shown.");
  expect(moneyLine({ window: 12340, projected: 52886 }, "USD")).toBe(
    "About USD 12,340 in 7 days (about USD 52,886 in 30 days if the last 7 days repeat).",
  );
}

/** The scope word of a series rank: −1 tariff, 0 asset, 1…999,999 location, 1,000,000 organization. */
export function theScopeWordComesFromTheRank(): void {
  expect(scopeWord(-1)).toBe("tariff");
  expect(scopeWord(0)).toBe("asset");
  expect(scopeWord(1)).toBe("location");
  expect(scopeWord(ORGANIZATION_RANK - 1)).toBe("location");
  expect(scopeWord(ORGANIZATION_RANK)).toBe("organization");
}

/** Every assumption, exact; a date is the asset's local date. */
export function theAssumptionsAreExact(): void {
  const days = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"];
  expect(windowAssumption(days, KOLKATA)).toBe("Window: 10 Nov 2026 to 16 Nov 2026 (7 complete days), Asia/Kolkata.");

  // 2026-03-31T19:00Z is 1 Apr 00:30 in Kolkata: the date is the local one.
  const fromMs = ms("2026-03-31T19:00:00Z");
  const tariff = { name: "Fixture HT kVAh", effectiveFrom: "2026-04-01", energyUnit: "kvah" as const, billingMeter: true };
  expect(rateAssumption({ fromMs, toMs: null, value: 9, rank: -1 }, tariff, KOLKATA)).toBe(
    'Rate: tariff "Fixture HT kVAh", version from 1 Apr 2026, billed in kVAh; the month\'s bill ÷ kWh.',
  );
  expect(rateAssumption({ fromMs, toMs: null, value: 9, rank: -1 }, { ...tariff, energyUnit: "kwh" }, KOLKATA)).toBe(
    'Rate: tariff "Fixture HT kVAh", version from 1 Apr 2026, billed in kWh; the month\'s bill ÷ kWh.',
  );
  expect(rateAssumption({ fromMs, toMs: null, value: 9, rank: 0 }, null, KOLKATA)).toBe(
    "Rate: energy_tariff_per_kwh at asset scope, from 1 Apr 2026.",
  );
  expect(rateAssumption({ fromMs, toMs: null, value: 9, rank: 2 }, tariff, KOLKATA)).toBe(
    "Rate: energy_tariff_per_kwh at location scope, from 1 Apr 2026.",
  );
  expect(rateAssumption(undefined, null, KOLKATA)).toBe("No rate set.");

  expect(emissionAssumption({ fromMs, toMs: null, value: 0.716, rank: ORGANIZATION_RANK }, KOLKATA)).toBe(
    "Emission factor: 0.716 kg CO₂/kWh at organization scope, from 1 Apr 2026.",
  );
  expect(emissionAssumption(undefined, KOLKATA)).toBe("No grid emission factor set.");

  expect(thresholdAssumption({ fromMs, toMs: null, value: 0.9, rank: 0 })).toBe(
    "Threshold: 0.90 (tariff_pf_band, asset scope).",
  );
  expect(thresholdAssumption(undefined)).toBe("Threshold: 0.95 (default; tariff_pf_band is not set).");
  expect(TARGET_PF_ASSUMPTION).toBe("Target power factor: 0.99 (fixed).");
  expect(pfSourceAssumption("registers")).toBe("Power factor from the kWh and kVAh registers.");
  expect(pfSourceAssumption("kva")).toBe("Power factor estimated from hourly kW and kVA.");
  expect(pfSourceAssumption("pf")).toBe("Power factor estimated from hourly kW and PF.");
  expect(baselineAssumption({ source: "parameter", perDay: 1000 }, "INR")).toBe(
    "Baseline: your energy_baseline_kwh_per_day of 1,000 kWh/day × 7.",
  );
  expect(baselineAssumption({ source: "history", windows: 4 }, "INR")).toBe(
    "Baseline: the median of 4 earlier 7-day windows (own history).",
  );
  expect(NOT_BILLING_METER_ASSUMPTION).toBe("Priced at the site's tariff rate; this meter is not the billing meter.");
  expect(PROJECTION_ASSUMPTION).toBe("30-day figure: the 7-day figure × 30 ÷ 7, if the last 7 days repeat.");
}

/** The context lines; both weak-signal sentences are the imported ones, unchanged. */
export function theContextUsesTheImportedWeakSignalSentences(): void {
  expect(contextLines({ unusualHours: 5, bothHours: 2, baselineOnlyHours: 3 })).toEqual([
    "5 unusual hours in this window on the Anomalies page (advisory); 2 marked by both methods.",
    MIXED_SENTENCE,
  ]);
  expect(contextLines({ unusualHours: 4, bothHours: 0, baselineOnlyHours: 4 })).toEqual([
    "4 unusual hours in this window on the Anomalies page (advisory); 0 marked by both methods.",
    BASELINE_ONLY_SENTENCE,
  ]);
  // No hour marked by both, but not every mark is the Baseline method's: the Baseline-only
  // sentence would be untrue, so the mixed one is used.
  expect(contextLines({ unusualHours: 3, bothHours: 0, baselineOnlyHours: 1 })[1]).toBe(MIXED_SENTENCE);
  expect(contextLines({ unusualHours: 1, bothHours: 1, baselineOnlyHours: 0 })[0]).toBe(
    "1 unusual hour in this window on the Anomalies page (advisory); 1 marked by both methods.",
  );
  expect(contextLines({ unusualHours: 0, bothHours: 0, baselineOnlyHours: 0 })).toEqual([]);
}

/** No sentence holds `%`, and "saving" appears only in the disclaimer. */
export function noSentenceHoldsAPercentOrASaving(): void {
  const fromMs = ms("2026-04-01T00:00:00Z");
  const sentences = [
    pfHeadline(0.87, 0.95),
    pfAvoidableLine({ window: 1, projected: 4 }, "INR"),
    moneyLine({ window: 1, projected: 4 }, "INR"),
    pfNoMoneyLine("kwh_tariff", "INR"),
    pfNoMoneyLine("no_tariff", "INR"),
    pfNoMoneyLine("no_rate", "INR"),
    kvarLine(1, "INR"),
    excessHeadline(2, 2, 1, "parameter", "INR"),
    excessHeadline(2, 2, 1, "history", "INR"),
    excessKwhLine({ window: 1, projected: 4 }, "INR"),
    excessNoRateLine("INR"),
    co2Line({ window: 1, projected: 4 }, "INR"),
    ...contextLines({ unusualHours: 2, bothHours: 1, baselineOnlyHours: 1 }),
    windowAssumption(["2026-11-10", "2026-11-16"], KOLKATA),
    rateAssumption({ fromMs, toMs: null, value: 1, rank: 0 }, null, KOLKATA),
    rateAssumption(undefined, null, KOLKATA),
    emissionAssumption(undefined, KOLKATA),
    thresholdAssumption(undefined),
    TARGET_PF_ASSUMPTION,
    pfSourceAssumption("pf"),
    baselineAssumption({ source: "history", windows: 3 }, "INR"),
    NOT_BILLING_METER_ASSUMPTION,
    PROJECTION_ASSUMPTION,
  ];
  for (const sentence of sentences) {
    expect(sentence).not.toContain("%");
    expect(sentence.toLowerCase()).not.toContain("saving");
  }
  // Positive control: the disclaimer is the one place the word lives.
  expect(ADVISORY_DISCLAIMER.toLowerCase()).toContain("saving");
}
