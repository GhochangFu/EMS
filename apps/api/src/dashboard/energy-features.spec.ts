import { expect } from "vitest";

import { ENERGY_DATA_WINDOW_DAYS, resolveLocationEnergy } from "./energy-features";

/**
 * `F4.364` (ADR 0133 decisions 2–4, plan rulings Q5 and D3) — the pure resolution of an
 * organization's two settings for one location. The SQL that supplies `hasEnergyData` and
 * `totalKw` is `dashboard-energy.integration.spec.ts`. The sibling `.test.ts` carries the
 * `it()`s (ADR 0014).
 */

const base = { energyFeatures: "auto", cardPrimaryMetric: "auto", hasEnergyData: true, totalKw: 42 } as const;

/** R1 — the window is 30 days (ADR 0133 decision 2). */
export function runTheWindowIsThirtyDays(): void {
  expect(ENERGY_DATA_WINDOW_DAYS).toBe(30);
}

/** R2 — on / off / auto × energy data yes / no. */
export function runTheEnergySettingTable(): void {
  const cases = [
    ["on", true, true],
    ["on", false, true],
    ["off", true, false],
    ["off", false, false],
    ["auto", true, true],
    ["auto", false, false],
  ] as const;
  for (const [energyFeatures, hasEnergyData, shown] of cases) {
    const got = resolveLocationEnergy({ ...base, energyFeatures, hasEnergyData });
    expect(got.energyShown, `${energyFeatures} × data ${hasEnergyData}`).toBe(shown);
  }
}

/** R3 — the five card settings × energy shown yes / no; `kw` is honoured when hidden (Q5). */
export function runTheCardSettingTable(): void {
  const cases = [
    ["auto", "on", "kw"],
    ["auto", "off", "health"],
    ["kw", "on", "kw"],
    ["kw", "off", "kw"],
    ["health", "on", "health"],
    ["health", "off", "health"],
    ["critical_alarms", "on", "critical_alarms"],
    ["critical_alarms", "off", "critical_alarms"],
    ["none", "on", "none"],
    ["none", "off", "none"],
  ] as const;
  for (const [cardPrimaryMetric, energyFeatures, metric] of cases) {
    const got = resolveLocationEnergy({ ...base, cardPrimaryMetric, energyFeatures });
    expect(got.primaryMetric, `${cardPrimaryMetric} with energy ${energyFeatures}`).toBe(metric);
  }
}

/** R4 — `totalKw` is null when not shown, stays null when shown with no value, and passes a number through. */
export function runTheTotalKw(): void {
  expect(resolveLocationEnergy({ ...base, energyFeatures: "off" }).totalKw).toBeNull();
  expect(resolveLocationEnergy({ ...base, hasEnergyData: false }).totalKw).toBeNull();
  expect(resolveLocationEnergy({ ...base, energyFeatures: "on", hasEnergyData: false, totalKw: null }).totalKw).toBeNull();
  expect(resolveLocationEnergy({ ...base, totalKw: 0 }).totalKw).toBe(0);
  expect(resolveLocationEnergy(base).totalKw).toBe(42);
}

/** R5 — a stored value outside the lists reads as `auto` (D3, the F4.108 rule). */
export function runAnUnknownValueActsAsAuto(): void {
  expect(resolveLocationEnergy({ ...base, energyFeatures: "maybe", hasEnergyData: false })).toEqual({
    energyShown: false,
    primaryMetric: "health",
    totalKw: null,
  });
  expect(resolveLocationEnergy({ ...base, energyFeatures: "maybe", cardPrimaryMetric: "teal" })).toEqual({
    energyShown: true,
    primaryMetric: "kw",
    totalKw: 42,
  });
  expect(resolveLocationEnergy({ ...base, energyFeatures: null, cardPrimaryMetric: undefined }).primaryMetric).toBe("kw");
}
