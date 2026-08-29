import { expect } from "vitest";

import { WIDGET_POINT_CARDINALITY } from "@bms/shared";

import { CHART_SERIES, WIDGET_CATALOG, WIDGET_TONE_COLOR } from "./widget-catalog";

/**
 * `F3.1c` Task 4 — the widget catalog (ADR 0047, Amendment 2 §1 and §4).
 * Assertions live here; `widget-catalog.test.ts` is the Vitest entry point
 * (ADR 0014).
 */

/**
 * Hardcoding `{min:1,max:1}` for `chart` would carry the *correct numbers*
 * today and still be the drift Amendment 2 §1 exists to prevent — the write
 * path (`F3.1b`) and this renderer would each hold their own copy, free to
 * diverge the next time either is touched. `toBe` (reference identity)
 * catches that; `toEqual` would not, because it only compares values.
 */
export function catalogCardinalityIsImportedNotRestated(): void {
  for (const type of Object.keys(WIDGET_CATALOG) as (keyof typeof WIDGET_CATALOG)[]) {
    expect(
      WIDGET_CATALOG[type].points,
      `${type}'s points must be the imported WIDGET_POINT_CARDINALITY object, not a copy`,
    ).toBe(WIDGET_POINT_CARDINALITY[type]);
  }
}

/**
 * `dashboard_widgets_grid_bounds_check` is the database's bound. A default
 * outside it means every widget `F3.1d` creates from this catalog is
 * rejected on save with a constraint name instead of a form error.
 */
export function catalogDefaultSizesFitTheGrid(): void {
  for (const entry of Object.values(WIDGET_CATALOG)) {
    expect(entry.defaultSize.w).toBeGreaterThanOrEqual(1);
    expect(entry.defaultSize.w).toBeLessThanOrEqual(12);
    expect(entry.defaultSize.h).toBeGreaterThanOrEqual(1);
    expect(entry.defaultSize.h).toBeLessThanOrEqual(24);
  }
}

/** `widgetTitle`'s fallback (Task 1) reads this label; an empty one renders an empty heading. */
export function catalogLabelsAreNonEmpty(): void {
  for (const entry of Object.values(WIDGET_CATALOG)) {
    expect(entry.label.length).toBeGreaterThan(0);
  }
}

/**
 * Decision 4: "The builder shows plain labels, not ECharts series names."
 * Pinned literally — a regression surfacing `"line"` or `"bar"` puts an API
 * name in front of a non-programmer, and this is the only place that would
 * catch a silent rename.
 */
export function chartSeriesLabelsArePinned(): void {
  expect(CHART_SERIES.line.label).toBe("Trend");
  expect(CHART_SERIES.area.label).toBe("Trend (filled)");
  expect(CHART_SERIES.bar.label).toBe("Comparison bars");
  expect(CHART_SERIES.scatter.label).toBe("Scatter");
}

/**
 * The one mapping a reader will "simplify" to `type: "area"`, which ECharts
 * does not have. `area` is `line` plus `areaStyle`.
 */
export function areaSeriesIsLineWithAreaStyle(): void {
  expect(CHART_SERIES.area.type).toBe("line");
  expect(CHART_SERIES.area.area).toBe(true);
  expect(CHART_SERIES.line.area).toBe(false);
  expect(CHART_SERIES.bar.type).toBe("bar");
  expect(CHART_SERIES.scatter.type).toBe("scatter");
}

/**
 * Pinned to `TRINETRA.html:12`'s literal hexes, not merely "looks like a
 * colour" — a shape-only `/^#[0-9A-Fa-f]{6}$/` check leaves `ok` and
 * `critical` free to swap, which is a green suite and a healthy gauge band
 * (or a healthy tank fill) rendering red.
 */
export function toneColorsMatchTheMockupPaletteExactly(): void {
  expect(WIDGET_TONE_COLOR.ok, "TRINETRA.html:12 --sc").toBe("#039855");
  expect(WIDGET_TONE_COLOR.info, "TRINETRA.html:12 --in").toBe("#1570EF");
  expect(WIDGET_TONE_COLOR.warning, "TRINETRA.html:12 --wn").toBe("#DC6803");
  expect(WIDGET_TONE_COLOR.critical, "TRINETRA.html:12 --cr").toBe("#D92D20");
}
