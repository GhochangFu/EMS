import { expect } from "vitest";

import type { SiteTrendStripDto } from "@bms/shared";

import { HEATMAP_FIT_REASON } from "./chart-kind-fit";
import { blankDashboardWidgetRow } from "./dashboard-builder-form";
import {
  CHART_NO_POINTS_SENTENCE,
  CHART_TAB_FULL_SENTENCE,
  chartAppendBodyFor,
  chartHeatmapOnePointSentence,
  chartPairsFor,
  chartProblemFor,
  chartRowFor,
  chartTooManyPointsSentence,
} from "./trend-strip-wizard-chart";

/**
 * `F4.324` PR 2 (ADR 0108 Amendment 9 item 3) — the wizard's *Draw as Chart*, pure half.
 * Assertions live here; `trend-strip-wizard-chart.test.ts` is the Vitest entry point (ADR 0014).
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const asset = (assetId: string, assetCode: string) => ({ assetId, assetCode, buckets: [] });

const STRIP = {
  segments: [
    {
      domain: "pumps",
      points: [
        { code: "kw", assets: [asset(A, "P-01"), asset(B, "P-02")], moreAssets: 0 },
        { code: "flow", assets: [asset(A, "P-01")], moreAssets: 0 },
      ],
    },
  ],
} as unknown as SiteTrendStripDto;

const DONUT = { kind: "chart", series: "donut", aggregate: "sum" } as const;

export function thePairsFollowTheSelectionThenTheStrip(): void {
  expect(chartPairsFor(STRIP, ["pumps:flow", "pumps:kw"])).toEqual({
    pairs: [
      { assetId: A, assetCode: "P-01", pointKey: "flow" },
      { assetId: A, assetCode: "P-01", pointKey: "kw" },
      { assetId: B, assetCode: "P-02", pointKey: "kw" },
    ],
    hidden: 0,
  });
  expect(chartPairsFor(STRIP, undefined).pairs.map((p) => p.pointKey)).toEqual(["kw", "kw", "flow"]);
}

/** The strip shows at most 6 assets a point; the rest (`moreAssets`) are counted, never dropped silently. */
export function theStripsHiddenAssetsAreCounted(): void {
  const capped = {
    segments: [{ domain: "pumps", points: [{ code: "kw", assets: [asset(A, "P-01")], moreAssets: 8 }] }],
  } as unknown as SiteTrendStripDto;
  const { pairs, hidden } = chartPairsFor(capped, ["pumps:kw"]);
  expect([pairs.length, hidden]).toEqual([1, 8]);
  expect(chartProblemFor({ pairs, hidden, widgetCount: 0 }, DONUT, "24h")).toBe(chartTooManyPointsSentence(9));
  // Hidden but under the cap is still refused for a heatmap: it draws one asset point.
  const heatmap = { kind: "chart", series: "heatmap", aggregate: "avg" } as const;
  expect(chartProblemFor({ pairs, hidden: 1, widgetCount: 0 }, heatmap, "7d")).toBe(chartHeatmapOnePointSentence(2));
}

export function aTabsProblemsAreNamedNeverCut(): void {
  const tab = (count: number, widgetCount = 0) => ({
    pairs: Array.from({ length: count }, (_, i) => ({ assetId: A, assetCode: `P-${i}`, pointKey: "kw" })),
    hidden: 0,
    widgetCount,
  });
  expect(chartProblemFor(tab(0), DONUT, "24h")).toBe(CHART_NO_POINTS_SENTENCE);
  expect(chartProblemFor(tab(9), DONUT, "24h")).toBe(chartTooManyPointsSentence(9));
  expect(chartProblemFor(tab(8), DONUT, "24h")).toBeNull();
  expect(chartProblemFor(tab(1, 40), DONUT, "24h")).toBe(CHART_TAB_FULL_SENTENCE);
  const heatmap = { kind: "chart", series: "heatmap", aggregate: "avg" } as const;
  expect(chartProblemFor(tab(1), heatmap, "24h")).toBe(HEATMAP_FIT_REASON);
  expect(chartProblemFor(tab(1), heatmap, "7d")).toBeNull();
  expect(chartProblemFor(tab(2), heatmap, "7d")).toBe(chartHeatmapOnePointSentence(2));
}

export function theAppendBodyCarriesTheKindTheRangeAndThePoints(): void {
  const { pairs } = chartPairsFor(STRIP, ["pumps:kw"]);
  expect(chartAppendBodyFor(pairs, DONUT, "7d", "pumps")).toEqual({
    tabKey: "pumps",
    gridW: 6,
    gridH: 4,
    config: { windowMinutes: 10_080, aggregate: "sum", series: "donut" },
    points: [
      { assetId: A, pointKey: "kw" },
      { assetId: B, pointKey: "kw" },
    ],
  });
  const line = chartAppendBodyFor(pairs, { kind: "chart", series: "line", aggregate: "avg" }, "24h", null);
  expect(line.config.series).toBe("line");
  expect("tabKey" in line).toBe(false);
}

export function theDraftRowIsInsertedAtTheFootOfItsTab(): void {
  const strip = { ...blankDashboardWidgetRow("trend_strip"), tabKey: "pumps", gridY: 0, gridH: 4 };
  const tile = { ...blankDashboardWidgetRow("value_tile"), tabKey: "pumps", gridY: 4, gridH: 2 };
  const elsewhere = { ...blankDashboardWidgetRow("value_tile"), tabKey: "other", gridY: 20, gridH: 2 };
  const row = chartRowFor(
    [strip, tile, elsewhere],
    [{ assetId: A, assetCode: "P-01", pointKey: "kw", pointId: "pt-1" }],
    DONUT,
    "30d",
    "pumps",
  );
  expect(row.widgetType).toBe("chart");
  expect([row.tabKey, row.gridX, row.gridY, row.gridW, row.gridH]).toEqual(["pumps", 0, 6, 6, 4]);
  expect(row.points).toEqual([{ pointId: "pt-1", role: "series", sortOrder: 0, label: "P-01 · kw" }]);
  expect([row.config.series, row.config.windowMinutes, row.config.chartAggregate]).toEqual(["donut", "43200", "sum"]);
}
