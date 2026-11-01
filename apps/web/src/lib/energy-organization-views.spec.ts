import { expect } from "vitest";

import type { EnergyAbnormalEntry, EnergyHeatmapCell, EnergySiteEnergy, EnergySiteTrend } from "@bms/shared";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import {
  abnormalGroups,
  baselineSentence,
  colourMax,
  heatmapGrid,
  percentChange,
  rankingRows,
  siteStacks,
} from "./energy-organization-views";
import { resolveRoles } from "./theme";

/** `F4.299` U5 (ADR 0108 Amendment 1) — the pure helpers behind the organization views. */

const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));

function site(name: string, kwh: number, peakKw = 1): EnergySiteEnergy {
  return {
    locationId: `00000000-0000-4000-8000-${name.charCodeAt(0).toString().padStart(12, "0")}`,
    name,
    assetCount: 1,
    kwh,
    peakKw,
    peakAt: null,
  };
}

export function percentChangeIsThePercentAndNullAgainstZero(): void {
  expect(percentChange(112.5, 100)).toBe(12.5);
  expect(percentChange(50, 0)).toBeNull();
}

export function rankingRowsSortByKwhDescending(): void {
  const rows = rankingRows([site("B", 10), site("A", 30), site("C", 20)], null, "kwh");
  expect(rows.map((r) => r.site.name)).toEqual(["A", "C", "B"]);
}

export function rankingRowsSortByPeakKw(): void {
  const rows = rankingRows([site("A", 30, 1), site("B", 10, 9), site("C", 20, 5)], null, "peakKw");
  expect(rows.map((r) => r.site.name)).toEqual(["B", "C", "A"]);
}

export function theChangeIsNoneWithoutACompare(): void {
  const rows = rankingRows([site("A", 30)], null, "kwh");
  expect(rows[0].change).toEqual({ kind: "none" });
}

export function theChangeIsNoPreviousForASiteAbsentFromTheCompare(): void {
  const rows = rankingRows([site("A", 30), site("B", 20)], [site("A", 20)], "kwh");
  expect(rows.find((r) => r.site.name === "B")?.change).toEqual({ kind: "no_previous" });
  expect(rows.find((r) => r.site.name === "A")?.change).toEqual({ kind: "change", pct: 50 });
}

export function theChangeHasNoPercentWhenThePreviousKwhIsZero(): void {
  const rows = rankingRows([site("A", 30)], [site("A", 0)], "kwh");
  expect(rows[0].change).toEqual({ kind: "change", pct: null });
}

export function heatmapGridHasAscendingDaysTwentyFourHoursAndNullForAMissingCell(): void {
  const cells: EnergyHeatmapCell[] = [
    { day: "2026-11-02", hour: 3, kwh: 7 },
    { day: "2026-11-01", hour: 23, kwh: 5 },
  ];
  const grid = heatmapGrid(cells);
  expect(grid.days).toEqual(["2026-11-01", "2026-11-02"]);
  expect(grid.hours).toEqual(Array.from({ length: 24 }, (_, h) => h));
  expect(grid.values[0][23]).toBe(5);
  expect(grid.values[1][3]).toBe(7);
  expect(grid.values[0][0]).toBeNull();
}

export function colourMaxIsTheNearestRankNinetyFifthPercentile(): void {
  const cells: EnergyHeatmapCell[] = [
    ...Array.from({ length: 99 }, (_, i) => ({ day: "2026-11-01", hour: i % 24, kwh: i + 1 })),
    { day: "2026-11-02", hour: 0, kwh: 1000 },
  ];
  expect(colourMax(cells)).toBe(95);
}

export function colourMaxOfASingleCellIsItsValueAndOfNoneIsZero(): void {
  expect(colourMax([{ day: "2026-11-01", hour: 0, kwh: 4 }])).toBe(4);
  expect(colourMax([])).toBe(0);
}

function entry(kind: "site" | "asset", verdict: EnergyAbnormalEntry["verdict"], name: string): EnergyAbnormalEntry {
  return {
    kind,
    id: "00000000-0000-4000-8000-000000000001",
    code: null,
    name,
    siteName: null,
    currentKwh: 10,
    baselineKwh: verdict === "above" ? 5 : null,
    ratio: verdict === "above" ? 2 : null,
    verdict,
    baselineWindows: 4,
  };
}

export function abnormalGroupsSplitTheVerdictsAndCarryTheCounts(): void {
  const groups = abnormalGroups({
    baseline: { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5 },
    entries: [entry("site", "above", "A"), entry("asset", "not_enough_history", "B")],
    normalCount: { sites: 3, assets: 9 },
    truncated: true,
  });
  expect(groups.above.map((e) => e.name)).toEqual(["A"]);
  expect(groups.notEnoughHistory.map((e) => e.name)).toEqual(["B"]);
  expect(groups.normalCount).toEqual({ sites: 3, assets: 9 });
  expect(groups.truncated).toBe(true);
}

export function theBaselineSentenceNamesTheStepAndTheConsultedWindows(): void {
  expect(baselineSentence({ windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5 })).toBe(
    "≥ 50 % above the median of the same window on the 4 preceding days",
  );
  expect(baselineSentence({ windows: 4, windowsConsulted: 4, stepDays: 7, ratio: 1.5 })).toBe(
    "≥ 50 % above the median of the same window in the 4 preceding 7-day windows",
  );
  expect(baselineSentence({ windows: 4, windowsConsulted: 1, stepDays: 1, ratio: 1.5 })).toBe(
    "≥ 50 % above the median of the same window; only 1 of 4 windows is within the retained history at this detail level",
  );
}

export function siteStacksGiveOneStackPerColumnAndLabelOther(): void {
  const trend: EnergySiteTrend = {
    columns: [{ kind: "site", locationId: "00000000-0000-4000-8000-000000000001", name: "Plant 1" }, { kind: "other" }],
    points: [
      { t: "2026-11-01T00:00:00.000Z", kw: [3, 1] },
      { t: "2026-11-01T01:00:00.000Z", kw: [4, 2] },
    ],
  };
  const stacks = siteStacks(trend, roles);
  expect(stacks.map((s) => s.name)).toEqual(["Plant 1", "Other sites"]);
  expect(stacks[0].data).toEqual([
    ["2026-11-01T00:00:00.000Z", 3],
    ["2026-11-01T01:00:00.000Z", 4],
  ]);
  expect(stacks[1].data[1]).toEqual(["2026-11-01T01:00:00.000Z", 2]);
}
