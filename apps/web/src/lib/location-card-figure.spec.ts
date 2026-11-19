import { expect } from "vitest";

import { locationKpiSummarySchema } from "@bms/shared/contracts";
import type { LocationKpiSummary } from "@bms/shared";

import { kwText, primaryFigure } from "./location-card-figure";

/**
 * `F4.364` (ADR 0133 decision 4, plan U6) — the kW figure text now that the summary's `totalKw`
 * is `number | null`. The sibling `.test.ts` carries the `it()`s (ADR 0014).
 */

/** F1 — `null` is an em dash, never `0.0`; a number keeps one decimal, `0` included. */
export function runKwText(): void {
  expect(kwText(null)).toBe("—");
  expect(kwText(0)).toBe("0.0");
  expect(kwText(12.34)).toBe("12.3");
}

function location(over: Partial<LocationKpiSummary>): LocationKpiSummary {
  return locationKpiSummarySchema.parse({
    id: "loc-1",
    name: "Cold store",
    code: "C1",
    type: "site",
    typeLabel: "Site",
    province: null,
    organization: { id: "o1", code: "WBLDC", name: "WBLDC" },
    rtuCount: 1,
    assetCount: 4,
    freshAssetCount: 2,
    totalKw: 12.34,
    energyShown: true,
    primaryMetric: "kw",
    healthScore: null,
    openAlarms: 5,
    criticalAlarms: 3,
    scopeLabel: "full",
    parentId: null,
    ...over,
  });
}

/**
 * F2 — `primaryFigure` (`F4.364` D10, ADR 0133 decision 3): kW one decimal; health as a whole
 * percentage, `—` (never `0%`) when nothing is scored; critical alarms as the count; `none` is no
 * figure at all.
 */
export function runPrimaryFigure(): void {
  expect(primaryFigure(location({ primaryMetric: "kw" }))).toEqual({ value: "12.3", label: "kW" });
  expect(primaryFigure(location({ primaryMetric: "kw", totalKw: null, energyShown: false }))).toEqual({
    value: "—",
    label: "kW",
  });
  expect(primaryFigure(location({ primaryMetric: "health", healthScore: 0.994 }))).toEqual({ value: "99%", label: "health" });
  expect(primaryFigure(location({ primaryMetric: "health", healthScore: 0 }))).toEqual({ value: "0%", label: "health" });
  expect(primaryFigure(location({ primaryMetric: "health", healthScore: null }))).toEqual({ value: "—", label: "health" });
  expect(primaryFigure(location({ primaryMetric: "critical_alarms" }))).toEqual({ value: "3", label: "critical" });
  expect(primaryFigure(location({ primaryMetric: "none" }))).toBeNull();
}
