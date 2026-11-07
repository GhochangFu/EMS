import { expect } from "vitest";

import { HEATMAP_ONE_POINT_MESSAGE } from "../../contracts/chart-kinds";
import { chartSeriesKindSchema } from "../../contracts/dashboard-builder";
import { DASHBOARD_ENTRIES } from "./dashboards";
import type { CatalogSummaryInput } from "./types";

/**
 * `F4.324` (ADR 0099 Amendment 16) — `dashboard.widgets.appendChart`. Assertions live here;
 * `dashboards.test.ts` is the Vitest entry point (ADR 0014).
 */

const ASSET = "33333333-3333-4333-8333-333333333333";

function entry() {
  const found = DASHBOARD_ENTRIES.find((e) => e.id === "dashboard.widgets.appendChart");
  if (!found) throw new Error("dashboard.widgets.appendChart is not in the catalog");
  return found;
}

const body = (config: Record<string, unknown>, points = 1) => ({
  config: { windowMinutes: 10_080, aggregate: "avg", ...config },
  points: Array.from({ length: points }, (_, i) => ({ assetId: ASSET, pointKey: `p${i}` })),
});

export function eachKindIsProposable(): void {
  for (const series of chartSeriesKindSchema.options) {
    // `F4.325` — each kind at a window it fits: the 7-day fixture suits the heatmap, a matrix reads a day.
    const result = entry().body.safeParse(body({ series, ...(series === "matrix" ? { windowMinutes: 1_440 } : {}) }));
    expect(result.success, `${series}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  }
}

/** Decision 2: the trend arm stays out — a body naming `widgetType` is refused at propose. */
export function aTrendStripBodyIsRefused(): void {
  // A valid chart body plus `widgetType`: refused only because the arm is `.strict()` — the very
  // key the controller routes to the trend arm (`namesWidgetType`).
  const result = entry().body.safeParse({ ...body({}), widgetType: "trend_strip" });
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
}

/** The shared kind rule runs at propose, so a two-point heatmap never reaches the card. */
export function aTwoPointHeatmapIsRefusedAtPropose(): void {
  const result = entry().body.safeParse(body({ series: "heatmap" }, 2));
  expect(result.success).toBe(false);
  expect(result.error?.issues.map((i) => i.message)).toContain(HEATMAP_ONE_POINT_MESSAGE);
}

/** Decision 3: the card names the kind in the builder's words, the point count, the tab and the dashboard. */
export function theSummarySaysTheKindInTheBuildersWords(): void {
  const summary = (b: Record<string, unknown>) => {
    const input: CatalogSummaryInput = { body: b, params: {}, targetName: "Bilsi", organizationName: "PHE" };
    return entry().summary(input);
  };
  expect(summary({ ...body({ series: "donut" }, 3), tabKey: "pumps" })).toBe(
    'Add a Share (donut) chart of 3 points at the foot of the tab "pumps" on the dashboard "Bilsi".',
  );
  expect(summary(body({}))).toBe('Add a Trend chart of 1 point to the dashboard "Bilsi".');
}
