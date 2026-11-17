import {
  ADVISORY_MIN_COVERAGE,
  ADVISORY_TARGET_PF,
  ADVISORY_WINDOW_DAYS,
  advisorySchema,
  type Advisory,
} from "@bms/shared";
import { expect } from "vitest";

import {
  FIXTURE_TARIFF_KVAH,
  FIXTURE_WINDOW_MS,
  FIXTURE_WINDOWS,
  fixtureCandidate,
  fixtureInput,
  pairHours,
  seriesRow,
} from "./advisories.fixture";
import type { AdvisoryAssetInput } from "./advisory-engine.types";
import {
  NOT_BILLING_METER_ASSUMPTION,
  pfNoMoneyLine,
  pfSourceAssumption,
  thresholdAssumption,
} from "./advisory-lines";
import { lowPowerFactorAdvisory } from "./advisory-power-factor";

/**
 * `E1.6a` / ADR 0137 (plan §4.2, T1.4) — the low power factor advisory, pure.
 * Assertions live here; `advisory-power-factor.test.ts` is the entry point.
 */
const DAY_MS = 86_400_000;
const run = (input: AdvisoryAssetInput): Advisory | null => lowPowerFactorAdvisory(input, FIXTURE_WINDOWS);
const fired = (input: AdvisoryAssetInput): Advisory => {
  const advisory = run(input);
  expect(advisory).not.toBeNull();
  expect(advisorySchema.safeParse(advisory).success).toBe(true);
  return advisory!;
};
const kvarFor = (meanKw: number, pf: number): number =>
  meanKw * (Math.tan(Math.acos(pf)) - Math.tan(Math.acos(ADVISORY_TARGET_PF)));

/** Registers 8,700 kWh / 10,000 kVAh on a kVAh tariff: every figure by hand. */
export function theRegisterCaseMatchesHandArithmetic(): void {
  const advisory = fired(fixtureInput());
  expect(advisory.kind).toBe("low_power_factor");
  expect(advisory.powerFactor).toBe(0.87);
  // 10,000 − 8,700 ÷ 0.99 = 1,212.12…; × 30 ÷ 7 = 5,194.8…
  expect(advisory.kvah).toEqual({ window: 1212, projected: 5195 });
  // Mean kW is the window's 8,400 kWh over its 168 hours.
  expect(advisory.kvar).toBe(Math.round(kvarFor(50, 0.87)));
  // C = 84,000 (8,400 kWh at 10); money = C × (1 − PF ÷ 0.99).
  const money = 84000 * (1 - 0.87 / ADVISORY_TARGET_PF);
  expect(advisory.money).toEqual({ window: Math.round(money), projected: Math.round((money * 30) / 7) });
  expect(advisory.kwh).toBeNull();
  expect(advisory.co2Kg).toBeNull();
  expect(advisory.headline).toBe("Power factor averaged 0.87 over the last 7 days, below 0.95.");
  expect(advisory.lines).toHaveLength(3);
  expect(advisory.lines[0]).toContain("About 1,212 kVAh could be avoided");
  expect(advisory.lines[1]).toBe(
    `About ₹ ${Math.round(money).toLocaleString("en-IN")} in 7 days (about ₹ ${Math.round((money * 30) / 7).toLocaleString("en-IN")} in 30 days if the last 7 days repeat).`,
  );
  expect(advisory.lines[2]).toBe(`About ${Math.round(kvarFor(50, 0.87))} kVAr of correction would bring it to 0.99.`);
  expect(advisory.id).toBe(`${advisory.assetId}:low_power_factor`);
  expect(advisory.windowFrom).toBe(new Date(FIXTURE_WINDOWS.fromMs).toISOString());
  expect(advisory.windowTo).toBe(new Date(FIXTURE_WINDOWS.toMs).toISOString());
  expect(advisory.assumptions[0]).toBe("Window: 10 Nov 2026 to 16 Nov 2026 (7 complete days), Asia/Kolkata.");
  expect(advisory.assumptions).toContain(pfSourceAssumption("registers"));
  expect(advisory.assumptions).toContain(thresholdAssumption(undefined));
}

/** On a kWh tariff no money, and the kWh sentence. */
export function aKwhTariffShowsNoMoney(): void {
  const advisory = fired(fixtureInput({ tariff: { ...FIXTURE_TARIFF_KVAH, energyUnit: "kwh" } }));
  expect(advisory.money).toBeNull();
  expect(advisory.lines).toContain(pfNoMoneyLine("kwh_tariff", "INR"));
  expect(advisory.kvah).not.toBeNull();
}

/** With no tariff at all, R-j's sentence. */
export function noTariffShowsTheNoKvahTariffSentence(): void {
  const advisory = fired(fixtureInput({ tariff: null }));
  expect(advisory.money).toBeNull();
  expect(advisory.lines).toContain(pfNoMoneyLine("no_tariff", "INR"));
}

/** A kVAh tariff with one unpriced day: no money, the no-rate sentence, kVAh and kVAr still there. */
export function anUnpricedDayShowsNoMoney(): void {
  const dayMs = FIXTURE_WINDOWS.fromMs + 2 * DAY_MS;
  const rate = [seriesRow(Number.NaN, -1, dayMs, dayMs + DAY_MS), seriesRow(10, -1)];
  const input = fixtureInput();
  const advisory = fired({ ...input, series: { ...input.series, rate } });
  expect(advisory.money).toBeNull();
  expect(advisory.lines).toContain(pfNoMoneyLine("no_rate", "INR"));
  expect(advisory.kvah).toEqual({ window: 1212, projected: 5195 });
  expect(advisory.kvar).not.toBeNull();
}

/** No `kvah_total` delta: hourly kW ÷ kVA, estimated, over the window's own kWh. */
export function noKvahRegisterUsesKva(): void {
  const advisory = fired(
    fixtureInput({
      registers: { kwh: 8700, kvah: null, spanMs: FIXTURE_WINDOW_MS },
      pairHours: pairHours(() => ({ kw: 50, kva: 62.5, pf: null })),
    }),
  );
  expect(advisory.powerFactor).toBe(0.8);
  expect(advisory.confidence).toBe("estimated");
  expect(advisory.assumptions).toContain(pfSourceAssumption("kva"));
  // Ek is the window's 8,400 kWh, not the register's.
  const avoidable = 8400 / 0.8 - 8400 / ADVISORY_TARGET_PF;
  expect(advisory.kvah?.window).toBe(Math.round(avoidable));
}

/** Only `pf`: Σ kW ÷ Σ (kW ÷ pf), estimated; hours with pf 0 or 1.2 are left out. */
export function onlyPfUsesTheThirdPath(): void {
  const advisory = fired(
    fixtureInput({
      registers: { kwh: null, kvah: null, spanMs: 0 },
      pairHours: pairHours((i) => ({ kw: 50, kva: null, pf: i % 20 === 0 ? 0 : i % 20 === 1 ? 1.2 : 0.8 })),
    }),
  );
  expect(advisory.powerFactor).toBe(0.8);
  expect(advisory.confidence).toBe("estimated");
  expect(advisory.assumptions).toContain(pfSourceAssumption("pf"));
  const avoidable = 8400 / 0.8 - 8400 / ADVISORY_TARGET_PF;
  expect(advisory.kvah?.window).toBe(Math.round(avoidable));
}

/** A register PF above 1 (1.04) is not a power factor: path (ii) answers. */
export function aRegisterPfAboveOneFallsThrough(): void {
  const advisory = fired(
    fixtureInput({
      registers: { kwh: 10400, kvah: 10000, spanMs: FIXTURE_WINDOW_MS },
      pairHours: pairHours(() => ({ kw: 50, kva: 62.5, pf: null })),
    }),
  );
  expect(advisory.powerFactor).toBe(0.8);
  expect(advisory.assumptions).toContain(pfSourceAssumption("kva"));
}

/** No path gives a value: no advisory. */
export function noPathGivesNoAdvisory(): void {
  expect(run(fixtureInput({ registers: { kwh: null, kvah: null, spanMs: 0 }, pairHours: [] }))).toBeNull();
  expect(
    run(fixtureInput({ registers: { kwh: null, kvah: null, spanMs: 0 }, pairHours: pairHours(() => ({ kw: 50, kva: null, pf: 0 })) })),
  ).toBeNull();
}

const withRegisters = (kwh: number, kvah: number, band?: number): AdvisoryAssetInput => {
  const input = fixtureInput({ registers: { kwh, kvah, spanMs: FIXTURE_WINDOW_MS } });
  return band === undefined ? input : { ...input, series: { ...input.series, pfBand: [seriesRow(band, 0)] } };
};

/** The comparison uses the rounded PF (R-g); the band moves the threshold; 0.99 or more never fires. */
export function theTriggerUsesTheRoundedPf(): void {
  expect(run(withRegisters(949, 1000))).toBeNull();
  expect(run(withRegisters(944, 1000))?.powerFactor).toBe(0.94);
  expect(run(withRegisters(920, 1000, 0.9))).toBeNull();
  expect(run(withRegisters(890, 1000, 0.9))?.headline).toBe(
    "Power factor averaged 0.89 over the last 7 days, below 0.90.",
  );
  expect(run(withRegisters(ADVISORY_TARGET_PF * 1000, 1000, 1))).toBeNull();
  expect(run(withRegisters(1000, 1000, 1))).toBeNull();
}

/** A 3-decimal band (0.932) fires on 0.928 and prints as set; a band outside (0, 1] falls back to 0.95 and says so. */
export function theBandPrintsAsSetAndAnOutOfRangeOneIsNamed(): void {
  expect(fired(withRegisters(928, 1000, 0.932)).headline).toBe(
    "Power factor averaged 0.93 over the last 7 days, below 0.932.",
  );
  const ignored = fired(withRegisters(870, 1000, 1.2));
  expect(ignored.headline).toBe("Power factor averaged 0.87 over the last 7 days, below 0.95.");
  expect(ignored.assumptions).toContain("Threshold: 0.95 (default; tariff_pf_band at asset scope is outside 0–1).");
  expect(ignored.confidence).toBe("estimated");
}

// PF coverage (owner ruling 2026-11-17, E1.6a code review): the evidence must cover ADVISORY_MIN_COVERAGE of the window.
const MIN_SPAN_MS = ADVISORY_MIN_COVERAGE * FIXTURE_WINDOW_MS;
const MIN_HOURS = Math.ceil(ADVISORY_MIN_COVERAGE * 24 * ADVISORY_WINDOW_DAYS);
const noRegisters = { kwh: null, kvah: null, spanMs: 0 };

/** Path (i): register probes spanning the minimum pass; 1 ms less falls through to kW ÷ kVA, or to nothing. */
export function theRegisterPathNeedsCoverage(): void {
  const spanned = (spanMs: number, pairs: AdvisoryAssetInput["pairHours"] = []): AdvisoryAssetInput =>
    fixtureInput({ registers: { kwh: 8700, kvah: 10000, spanMs }, pairHours: pairs });
  const atThreshold = fired(spanned(MIN_SPAN_MS));
  expect(atThreshold.assumptions).toContain(pfSourceAssumption("registers"));
  expect(atThreshold.powerFactor).toBe(0.87);

  expect(run(spanned(MIN_SPAN_MS - 1))).toBeNull();

  const fellThrough = fired(spanned(MIN_SPAN_MS - 1, pairHours(() => ({ kw: 50, kva: 62.5, pf: null }))));
  expect(fellThrough.assumptions).toContain(pfSourceAssumption("kva"));
  expect(fellThrough.powerFactor).toBe(0.8);
}

/** Path (ii): kW and kVA in the minimum hours pass; one fewer falls through to kW and PF, or to nothing. */
export function theKvaPathNeedsCoverage(): void {
  const kvaHours = (n: number, pf: number | null) =>
    pairHours((i) => ({ kw: 50, kva: i < n ? 62.5 : null, pf }));
  const atThreshold = fired(fixtureInput({ registers: noRegisters, pairHours: kvaHours(MIN_HOURS, null) }));
  expect(atThreshold.assumptions).toContain(pfSourceAssumption("kva"));
  expect(atThreshold.powerFactor).toBe(0.8);

  expect(run(fixtureInput({ registers: noRegisters, pairHours: kvaHours(MIN_HOURS - 1, null) }))).toBeNull();

  const fellThrough = fired(fixtureInput({ registers: noRegisters, pairHours: kvaHours(MIN_HOURS - 1, 0.7) }));
  expect(fellThrough.assumptions).toContain(pfSourceAssumption("pf"));
  expect(fellThrough.powerFactor).toBe(0.7);
}

/** Path (iii): kW and a valid PF in the minimum hours pass; one fewer gives no advisory. */
export function thePfPathNeedsCoverage(): void {
  const pfHours = (n: number) => pairHours((i) => ({ kw: 50, kva: null, pf: i < n ? 0.8 : null }));
  const atThreshold = fired(fixtureInput({ registers: noRegisters, pairHours: pfHours(MIN_HOURS) }));
  expect(atThreshold.assumptions).toContain(pfSourceAssumption("pf"));
  expect(atThreshold.powerFactor).toBe(0.8);

  expect(run(fixtureInput({ registers: noRegisters, pairHours: pfHours(MIN_HOURS - 1) }))).toBeNull();
}

/** Measured only with registers, a band, and a billing meter. */
export function confidenceFollowsTheEvidence(): void {
  const measured = fired(withRegisters(8700, 10000, 0.95));
  expect(measured.confidence).toBe("measured");
  expect(measured.assumptions).toContain(thresholdAssumption(seriesRow(0.95, 0)));
  expect(measured.assumptions).not.toContain(NOT_BILLING_METER_ASSUMPTION);

  expect(fired(withRegisters(8700, 10000)).confidence).toBe("estimated");

  const banded = withRegisters(8700, 10000, 0.95);
  const notBilling = fired({ ...banded, tariff: { ...FIXTURE_TARIFF_KVAH, billingMeter: false } });
  expect(notBilling.money).not.toBeNull();
  expect(notBilling.confidence).toBe("estimated");
  expect(notBilling.assumptions).toContain(NOT_BILLING_METER_ASSUMPTION);
}

/** Only an electrical asset gets a power-factor advisory. */
export function onlyElectricalAssetsQualify(): void {
  expect(run(fixtureInput({ candidate: fixtureCandidate({ domain: "water" }) }))).toBeNull();
}
