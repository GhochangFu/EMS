import { expect } from "vitest";

import { placeTrendStrip, type TrendStripPlacementWidget } from "./trend-strip-placement";

/**
 * `F4.306` U7 (ADR 0108 Amendment 7, owner OQ1) — the one placement rule for a trend strip on a
 * tab. Assertions live here; `trend-strip-placement.test.ts` is the Vitest entry point (ADR 0014).
 * One claim per function, so a mutation reddens the `it` that owns it.
 */

const at = (widgetType: string, gridX: number, gridY: number, gridH = 2): TrendStripPlacementWidget => ({
  widgetType,
  gridX,
  gridY,
  gridH,
});

/** An empty tab takes the strip at its top. */
export function anEmptyTabInsertsAtTheTop(): void {
  expect(placeTrendStrip([])).toEqual({ kind: "insert", gridY: 0 });
}

/** A tab with no strip takes one at its foot: the largest `gridY + gridH`, not the last widget's edge. */
export function aTabWithoutAStripInsertsAtItsFoot(): void {
  const widgets = [at("chart", 0, 0, 9), at("radial_gauge", 6, 4, 2), at("chart", 0, 2, 3)];
  expect(placeTrendStrip(widgets)).toEqual({ kind: "insert", gridY: 9 });
}

/** A tab's one strip is replaced, wherever it sits in the list. */
export function aTabsOneStripIsReplaced(): void {
  const widgets = [at("chart", 0, 0), at("trend_strip", 0, 8, 4), at("chart", 6, 0)];
  expect(placeTrendStrip(widgets)).toEqual({ kind: "replace", index: 1 });
}

/** Of two strips, the one with the lowest `gridY` is replaced even when it sits further right and later in the list. */
export function theTopmostStripIsReplacedFirst(): void {
  const widgets = [at("trend_strip", 0, 6, 4), at("chart", 0, 0), at("trend_strip", 6, 2, 4)];
  expect(placeTrendStrip(widgets)).toEqual({ kind: "replace", index: 2 });
}

/** Two strips on one row: the one with the lowest `gridX` is replaced. */
export function aRowTieIsDecidedByGridX(): void {
  const widgets = [at("trend_strip", 6, 2, 4), at("trend_strip", 0, 2, 4)];
  expect(placeTrendStrip(widgets)).toEqual({ kind: "replace", index: 1 });
}

/** A strip is found by its type only: a neighbour of another type is never the replaced widget. */
export function aNonStripWidgetIsNeverReplaced(): void {
  const widgets = [at("chart", 0, 0), at("trend_points", 0, 1)];
  expect(placeTrendStrip(widgets)).toEqual({ kind: "insert", gridY: 3 });
}
