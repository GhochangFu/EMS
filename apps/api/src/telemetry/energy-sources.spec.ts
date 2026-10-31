import { expect } from "vitest";

import { nominalSourceSplit } from "./energy-sources";

/**
 * `F4.298` U3 (ADR 0108 decision 2.10) — the nominal grid / DG split, one rule
 * for its two callers: `dashboard/energy-centre.ts` (per series point, in kW)
 * and `reports/reports.service.ts` (the report's source totals, in kWh). The
 * figures are unit-free: the function takes a total and its solar part and
 * returns the DG and grid parts of the same unit, unrounded. Vitest entry
 * point: the sibling `.test.ts`.
 */

export function assertDgIsFourPercentOfTheNetLoad(): void {
  const split = nominalSourceSplit(100, 20);
  expect(split.dg).toBeCloseTo(3.2, 10);
  expect(split.grid).toBeCloseTo(76.8, 10);
}

export function assertNoSolarLeavesTheWholeTotalAsNet(): void {
  expect(nominalSourceSplit(100, 0)).toEqual({ dg: 4, grid: 96 });
}

export function assertSolarAboveTheTotalLeavesNoDgAndNoGrid(): void {
  expect(nominalSourceSplit(10, 30)).toEqual({ dg: 0, grid: 0 });
}

export function assertAZeroTotalSplitsToZero(): void {
  expect(nominalSourceSplit(0, 0)).toEqual({ dg: 0, grid: 0 });
}

export function assertTheThreePartsAddUpToTheTotal(): void {
  const total = 237.5;
  const solar = 41.25;
  const { dg, grid } = nominalSourceSplit(total, solar);
  expect(solar + dg + grid).toBeCloseTo(total, 10);
}

export function assertTheSplitIsNotRounded(): void {
  // 0.04 × 33.333 = 1.33332: a rounding caller keeps its own rounding.
  expect(nominalSourceSplit(33.333, 0).dg).toBeCloseTo(1.33332, 10);
}
