import { MAX_DASHBOARD_WIDGETS, MAX_WIDGET_POINTS, TREND_STRIP_RANGES } from "@bms/shared";
import type {
  AppendChartWidgetBody,
  ChartSeriesKind,
  PointAggregateFunction,
  SiteTrendStripDto,
  TrendStripRange,
} from "@bms/shared";

import { chartKindFitReason } from "./chart-kind-fit";
import { blankDashboardWidgetRow, type DashboardWidgetRow } from "./dashboard-builder-form";
import { CHART_SERIES, WIDGET_CATALOG } from "./widget-catalog";
import { blankConfigRow } from "./widget-config-form";

/**
 * `F4.324` PR 2 (ADR 0108 Amendment 9 item 3, owner ruling Q1) — the trend strip wizard's *Draw as
 * Chart*: the pure half. The wizard reads each chosen tab's strip (the assets the strip would draw
 * for the chosen points), and this file turns that into one chart per tab — an append body for the
 * site view, or a builder row for the draft. Nothing here reads the network or the clock.
 */

/** The window each strip range charts, in minutes: the range's own length, read from the strip's table. */
export const RANGE_MINUTES: Readonly<Record<TrendStripRange, number>> = {
  "24h": TREND_STRIP_RANGES["24h"].windowMinutes,
  "7d": TREND_STRIP_RANGES["7d"].windowMinutes,
  "30d": TREND_STRIP_RANGES["30d"].windowMinutes,
};

/** What Finish writes: today's strip, or one chart per tab of the chosen kind and function. */
export type DrawAs =
  | { readonly kind: "strip" }
  | { readonly kind: "chart"; readonly series: ChartSeriesKind; readonly aggregate: PointAggregateFunction };

/** One asset point a tab's chart binds: the strip's asset and the point's code. */
export interface ChartPair {
  readonly assetId: string;
  readonly assetCode: string;
  readonly pointKey: string;
}

/**
 * The asset points one tab's chart binds: for each chosen point (selection order; the strip's own
 * order when the selection names none), every asset the strip returned for it, in the strip's
 * order. An asset point is bound once.
 *
 * `hidden` counts the asset points the strip read left out: it returns at most
 * `TREND_STRIP_MAX_ASSETS_PER_POINT` assets per point (`moreAssets` counts the rest). A chart
 * never binds a subset silently, so a tab with any hidden asset is refused with the full count.
 */
export function chartPairsFor(
  strip: SiteTrendStripDto,
  selectionPoints: readonly string[] | undefined,
): { pairs: ChartPair[]; hidden: number } {
  const all = strip.segments.flatMap((segment) =>
    segment.points.map((point) => ({ key: `${segment.domain}:${point.code}`, point })),
  );
  const ordered =
    selectionPoints === undefined || selectionPoints.length === 0
      ? all
      : selectionPoints.flatMap((key) => all.filter((entry) => entry.key === key));
  const seen = new Set<string>();
  const pairs: ChartPair[] = [];
  let hidden = 0;
  for (const { point } of ordered) {
    hidden += point.moreAssets;
    for (const asset of point.assets) {
      const id = `${asset.assetId}|${point.code}`;
      if (seen.has(id)) continue;
      seen.add(id);
      pairs.push({ assetId: asset.assetId, assetCode: asset.assetCode, pointKey: point.code });
    }
  }
  return { pairs, hidden };
}

/** A tab whose strip holds no asset for the chosen points. */
export const CHART_NO_POINTS_SENTENCE = "No asset on this tab carries the chosen points.";

/** A tab at the widget cap: a chart adds a widget (a strip may replace one; a chart never does). */
export const CHART_TAB_FULL_SENTENCE = `This tab is full (${MAX_DASHBOARD_WIDGETS} widgets).`;

/** More asset points than one chart binds; `count` is the full count, hidden ones included. */
export const chartTooManyPointsSentence = (count: number): string =>
  `This tab has ${count} asset points; a chart holds at most ${MAX_WIDGET_POINTS}. Choose fewer points.`;

/** A daily pattern over more than one asset point on a tab. */
export const chartHeatmapOnePointSentence = (count: number): string =>
  `A daily pattern draws one asset point; this tab has ${count}. Choose one point on one asset.`;

/** What one tab holds for the chart: its pairs, the asset points the strip hid, and its widget count. */
export interface ChartTab {
  readonly pairs: readonly ChartPair[];
  readonly hidden: number;
  readonly widgetCount: number;
}

/**
 * Why one tab's chart cannot be written, or `null`. Never cut silently: more than
 * `MAX_WIDGET_POINTS` (hidden ones counted) is refused with the count; a full tab is refused before
 * any write; a heatmap names its own cause (one asset point, or a 7–30 day range).
 */
export function chartProblemFor(
  tab: ChartTab,
  drawAs: Extract<DrawAs, { kind: "chart" }>,
  range: TrendStripRange,
): string | null {
  const count = tab.pairs.length + tab.hidden;
  if (tab.widgetCount >= MAX_DASHBOARD_WIDGETS) return CHART_TAB_FULL_SENTENCE;
  if (count === 0) return CHART_NO_POINTS_SENTENCE;
  if (count > MAX_WIDGET_POINTS) return chartTooManyPointsSentence(count);
  if (CHART_SERIES[drawAs.series].axis === "grid" && count > 1) return chartHeatmapOnePointSentence(count);
  return chartKindFitReason(drawAs.series, { pointCount: count, windowMinutes: RANGE_MINUTES[range] });
}

/** The append chart arm's body for one tab: the catalog's chart size and the chosen kind. */
export function chartAppendBodyFor(
  pairs: readonly ChartPair[],
  drawAs: Extract<DrawAs, { kind: "chart" }>,
  range: TrendStripRange,
  tabKey: string | null,
): AppendChartWidgetBody {
  const { w, h } = WIDGET_CATALOG.chart.defaultSize;
  return {
    ...(tabKey === null ? {} : { tabKey }),
    gridW: w,
    gridH: h,
    config: {
      windowMinutes: RANGE_MINUTES[range],
      aggregate: drawAs.aggregate,
      // Always sent: a new path with no older body to keep byte-equal (the Pin dialog's reason).
      series: drawAs.series,
    },
    points: pairs.map((pair) => ({ assetId: pair.assetId, pointKey: pair.pointKey })),
  };
}

/** A chart pair with the builder's point id (`GET /assets/:assetId/points`). */
export interface ResolvedChartPair extends ChartPair {
  readonly pointId: string;
}

/**
 * The builder draft's chart row for one tab: inserted at the foot of that tab (never replacing a
 * strip, ADR 0108 Amendment 9 item 3), at `gridX 0`, the catalog's chart size, its points as
 * `series` bindings in order.
 */
export function chartRowFor(
  rows: readonly DashboardWidgetRow[],
  pairs: readonly ResolvedChartPair[],
  drawAs: Extract<DrawAs, { kind: "chart" }>,
  range: TrendStripRange,
  tabKey: string | undefined,
): DashboardWidgetRow {
  const onTab = rows.filter((row) => tabKey === undefined || row.tabKey === tabKey);
  const foot = onTab.reduce((bottom, row) => Math.max(bottom, row.gridY + row.gridH), 0);
  const { w, h } = WIDGET_CATALOG.chart.defaultSize;
  return {
    ...blankDashboardWidgetRow("chart"),
    ...(tabKey === undefined ? {} : { tabKey }),
    gridX: 0,
    gridY: foot,
    gridW: w,
    gridH: h,
    points: pairs.map((pair, sortOrder) => ({
      pointId: pair.pointId,
      role: "series" as const,
      sortOrder,
      label: `${pair.assetCode} · ${pair.pointKey}`,
    })),
    config: {
      ...blankConfigRow(),
      series: drawAs.series,
      windowMinutes: String(RANGE_MINUTES[range]),
      chartAggregate: drawAs.aggregate,
    },
  };
}
