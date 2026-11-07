import { expect } from "vitest";

import { chartKindChoices, chartKindFitReason, HEATMAP_FIT_REASON, MATRIX_FIT_REASON } from "./chart-kind-fit";
import { CHART_SERIES } from "./widget-catalog";

/**
 * `F4.324` (ADR 0108 Amendment 9 items 2 and 3) — whether a chart kind fits a view that is pinned
 * or placed, and in what words it does not. Assertions live here; `chart-kind-fit.test.ts` is the
 * Vitest entry point (ADR 0014).
 */

export function aHeatmapNeedsOnePointAndSevenToThirtyDays(): void {
  expect(chartKindFitReason("heatmap", { pointCount: 1, windowMinutes: 10_080 })).toBeNull();
  expect(chartKindFitReason("heatmap", { pointCount: 1, windowMinutes: 43_200 })).toBeNull();
  expect(chartKindFitReason("heatmap", { pointCount: 1, windowMinutes: 1_440 })).toBe(HEATMAP_FIT_REASON);
  expect(chartKindFitReason("heatmap", { pointCount: 2, windowMinutes: 10_080 })).toBe(HEATMAP_FIT_REASON);
  expect(HEATMAP_FIT_REASON).toBe("Needs a 7–30 day view of one point");
}

export function everyOtherKindFitsAnyView(): void {
  for (const kind of ["line", "area", "bar", "scatter", "step", "compare", "donut"] as const) {
    expect(chartKindFitReason(kind, { pointCount: 8, windowMinutes: 15 }), kind).toBeNull();
  }
}

export function theChoicesListEveryKindInCatalogOrderWithItsReason(): void {
  const choices = chartKindChoices({ pointCount: 3, windowMinutes: 1_440 });
  expect(choices.map((c) => c.value)).toEqual(Object.keys(CHART_SERIES));
  expect(choices.find((c) => c.value === "donut")).toEqual({ value: "donut", label: "Share (donut)", disabledReason: null });
  expect(choices.find((c) => c.value === "heatmap")).toEqual({
    value: "heatmap",
    label: "Daily pattern (hour × day)",
    disabledReason: HEATMAP_FIT_REASON,
  });
}

/** `F4.325` — a matrix fits a one-day view of up to eight points, and says so in plain words otherwise. */
export function aMatrixNeedsADayView(): void {
  expect(chartKindFitReason("matrix", { pointCount: 8, windowMinutes: 1_440 })).toBeNull();
  expect(chartKindFitReason("matrix", { pointCount: 2, windowMinutes: 10_080 })).toBe(MATRIX_FIT_REASON);
  expect(MATRIX_FIT_REASON).toBe("Needs a 24-hour view");
}
