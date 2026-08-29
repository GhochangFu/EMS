import { expect } from "vitest";

import type { ChartConfig, RadialGaugeConfig, WidgetSeries } from "./widget-catalog";
import { WIDGET_TONE_COLOR } from "./widget-catalog";
import { buildChartOption, buildRadialGaugeOption } from "./widget-echarts-option";

/**
 * `F3.1c` Task 2 — `widget-echarts-option.ts`'s gauge builder (ADR 0047).
 * Assertions live here; `widget-echarts-option.test.ts` is the Vitest entry
 * point (ADR 0014). Node environment, pure functions — nothing here renders
 * ECharts.
 *
 * `EChartsOption["series"]` is a broad union that fights a direct assertion
 * on `series[0].data[0].value`, so the option is read back through a minimal
 * local shape rather than the full echarts type — the option produced still
 * has to satisfy `EChartsOption` at the call site in `buildRadialGaugeOption`
 * itself, so this narrows only the read, not what is allowed to be written.
 */
type GaugeOptionShape = {
  readonly series: readonly [
    {
      readonly type: string;
      readonly min: number;
      readonly max: number;
      readonly axisLine: { readonly lineStyle: { readonly color: readonly (readonly [number, string])[] } };
      readonly data: readonly [{ readonly value: number }];
    },
  ];
};

function asGauge(option: unknown): GaugeOptionShape {
  return option as unknown as GaugeOptionShape;
}

export function gaugePutsMinMaxOnTheSeriesAndValueInData(): void {
  const option = asGauge(buildRadialGaugeOption({ min: 0, max: 100 }, 42));
  const series = option.series[0];
  expect(
    series.min,
    "a gauge ignoring config draws every reading against 0-100 — a pH gauge configured 6-8 pins the needle at the bottom for every healthy reading",
  ).toBe(0);
  expect(series.max).toBe(100);
  expect(series.data[0].value).toBe(42);
}

export function gaugeThresholdsBecomeAscendingFractionsEndingAtOne(): void {
  const config: RadialGaugeConfig = {
    min: 0,
    max: 100,
    thresholds: [
      { value: 60, tone: "warning" },
      { value: 80, tone: "critical" },
    ],
  };
  const stops = asGauge(buildRadialGaugeOption(config, 50)).series[0].axisLine.lineStyle.color;

  // Each ECharts stop paints the segment ENDING at its fraction. A
  // threshold means "at or above this value, the tone begins" (the
  // AutomationRuleOperator "gte" reading), so the band below the first
  // threshold must stay "ok" — painting it "warning" instead is exactly
  // the bug this pins: a healthy reading would sit on an elevated band.
  expect(stops[0], "the band before the first threshold must be the base ok tone, not the threshold's own").toEqual([
    0.6,
    WIDGET_TONE_COLOR.ok,
  ]);
  expect(stops[1]).toEqual([0.8, WIDGET_TONE_COLOR.warning]);
  expect(stops[2]).toEqual([1, WIDGET_TONE_COLOR.critical]);
  const last = stops.at(-1);
  expect(
    last?.[0],
    "a missing trailing 1 leaves the arc past the last threshold unpainted, and ECharts does not error on it",
  ).toBe(1);
  for (let i = 1; i < stops.length; i += 1) {
    expect(stops[i][0], "stops must be ascending or ECharts renders nonsense").toBeGreaterThanOrEqual(stops[i - 1][0]);
  }
}

/**
 * Every other gauge fixture in this file is `min: 0, max: 100` — both
 * ECharts' own default AND the identity for `(t.value - min) / (max - min)`,
 * so `min` never actually has to be subtracted for those to pass. A non-zero
 * `min` is the only fixture that can tell `(t.value - min) / range` apart
 * from `t.value / range`, and the only one that can tell `series.min` reading
 * `config.min` apart from a hardcoded `0`.
 */
export function gaugeMinOffsetIsSubtractedNotIgnored(): void {
  const config: RadialGaugeConfig = {
    min: 6,
    max: 8,
    thresholds: [{ value: 7.5, tone: "warning" }],
  };
  const option = asGauge(buildRadialGaugeOption(config, 7));
  const series = option.series[0];

  expect(series.min, "a hardcoded series.min=0 would pass every other fixture in this file").toBe(6);
  expect(series.max).toBe(8);

  const stops = series.axisLine.lineStyle.color;
  expect(
    stops[0],
    "(7.5 - 6) / 2 = 0.75; the un-offset (7.5 / 2 = 3.75, clamped to 1) is the defect this pins",
  ).toEqual([0.75, WIDGET_TONE_COLOR.ok]);
  expect(stops[1]).toEqual([1, WIDGET_TONE_COLOR.warning]);
}

export function gaugeThresholdsAreSortedRegardlessOfStorageOrder(): void {
  const outOfOrder: RadialGaugeConfig = {
    min: 0,
    max: 100,
    thresholds: [
      { value: 80, tone: "critical" },
      { value: 60, tone: "warning" },
    ],
  };
  const ordered: RadialGaugeConfig = {
    min: 0,
    max: 100,
    thresholds: [
      { value: 60, tone: "warning" },
      { value: 80, tone: "critical" },
    ],
  };

  expect(
    asGauge(buildRadialGaugeOption(outOfOrder, 50)).series[0].axisLine.lineStyle.color,
    "gaugeThresholdSchema imposes no ordering, so the store can hold [80,60] — unsorted stops make ECharts drop the arc silently",
  ).toEqual(asGauge(buildRadialGaugeOption(ordered, 50)).series[0].axisLine.lineStyle.color);
}

export function gaugeThresholdOutsideRangeIsClampedNotDropped(): void {
  // min: 6 rather than 0: -2 / 100 and (-2 - 0) / 100 both clamp to the same
  // 0, so a 0-min fixture cannot tell the offset apart from its absence. At
  // min: 6, the un-offset form (2 / 2 = 1) and the correct form
  // ((2 - 6) / 2 = -2, clamped to 0) land at opposite ends of the arc.
  const config: RadialGaugeConfig = {
    min: 6,
    max: 8,
    thresholds: [{ value: 2, tone: "warning" }],
  };
  const stops = asGauge(buildRadialGaugeOption(config, 7)).series[0].axisLine.lineStyle.color;
  expect(stops.length, "a threshold outside [min,max] must still produce a stop, not vanish").toBeGreaterThan(0);
  expect(stops[0][0]).toBe(0);
}

export function gaugeNeedleValueIsClampedIntoRange(): void {
  const config: RadialGaugeConfig = { min: 0, max: 100 };
  expect(
    asGauge(buildRadialGaugeOption(config, 150)).series[0].data[0].value,
    "a reading above max must not send the needle outside the widget box",
  ).toBe(100);
  expect(asGauge(buildRadialGaugeOption(config, -10)).series[0].data[0].value).toBe(0);
}

/**
 * Task 3 — `buildChartOption` (ADR 0047 decision 4, Amendment 2 §4). Read
 * back through a minimal local shape for the same reason the gauge
 * assertions above are: `EChartsOption["series"]` is a union that fights a
 * direct assertion on `series[0].type`/`.areaStyle`/`.stack`.
 */
type ChartOptionShape = {
  readonly xAxis: { readonly type: string; readonly min: string };
  readonly yAxis: { readonly type: string; readonly name?: string };
  readonly series: readonly {
    readonly name: string;
    readonly type: string;
    readonly areaStyle?: unknown;
    readonly stack?: string;
    readonly data: readonly (readonly [string, number | null])[];
  }[];
};

function asChart(option: unknown): ChartOptionShape {
  return option as unknown as ChartOptionShape;
}

const CHART_NOW = Date.parse("2026-08-29T12:00:00.000Z");

function oneChartSeries(name = "s1"): readonly WidgetSeries[] {
  return [{ name, sortOrder: 0, points: [{ t: "2026-08-29T11:00:00.000Z", v: 1 }] }];
}

export function chartLineSeriesHasNoAreaStyle(): void {
  const config: ChartConfig = { series: "line" };
  const out = asChart(buildChartOption(config, oneChartSeries(), CHART_NOW)).series[0];
  expect(out.type).toBe("line");
  expect(out.areaStyle, "'line' must not carry areaStyle, or it silently renders filled").toBeUndefined();
}

/** This is decision 4's entire payload. `area` is not an ECharts series type — it is `line` plus `areaStyle`. */
export function chartAreaSeriesIsLineWithAreaStyle(): void {
  const config: ChartConfig = { series: "area" };
  const out = asChart(buildChartOption(config, oneChartSeries(), CHART_NOW)).series[0];
  expect(out.type, "'area' is not an ECharts series type — it is line + areaStyle").toBe("line");
  expect(out.areaStyle).toBeDefined();
}

export function chartBarAndScatterMapDirectly(): void {
  expect(asChart(buildChartOption({ series: "bar" }, oneChartSeries(), CHART_NOW)).series[0].type).toBe("bar");
  expect(asChart(buildChartOption({ series: "scatter" }, oneChartSeries(), CHART_NOW)).series[0].type).toBe(
    "scatter",
  );
}

export function chartStackedSetsStackOnEverySeriesAbsentSetsNone(): void {
  const stacked = asChart(
    buildChartOption({ series: "line", stacked: true }, oneChartSeries(), CHART_NOW),
  ).series[0];
  expect(stacked.stack, "overlapping series read as one wrong total without a shared stack key").toBeDefined();

  const unstacked = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW)).series[0];
  expect(unstacked.stack).toBeUndefined();
}

export function chartYAxisLabelSetsNameAbsentOmitsIt(): void {
  const labelled = asChart(buildChartOption({ series: "line", yAxisLabel: "kW" }, oneChartSeries(), CHART_NOW));
  expect(labelled.yAxis.name).toBe("kW");

  const unlabelled = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW));
  expect(unlabelled.yAxis.name, "a configured label must not silently vanish").toBeUndefined();
}

export function chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow(): void {
  const withWindow = asChart(
    buildChartOption({ series: "line", windowMinutes: 60 }, oneChartSeries(), CHART_NOW),
  );
  expect(withWindow.xAxis.min).toBe(new Date(CHART_NOW - 60 * 60_000).toISOString());

  const defaulted = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW));
  expect(
    defaulted.xAxis.min,
    "absent windowMinutes must fall back to the documented day, not 'all data' — a widget configured for a day must not show a year",
  ).toBe(new Date(CHART_NOW - 1_440 * 60_000).toISOString());
}

export function chartNSeriesProduceNEntriesOrderedBySortOrder(): void {
  const series: readonly WidgetSeries[] = [
    { name: "third", sortOrder: 5, points: [] },
    { name: "first", sortOrder: -2, points: [] },
    { name: "second", sortOrder: 0, points: [] },
  ];
  const out = asChart(buildChartOption({ series: "line" }, series, CHART_NOW)).series;
  expect(out.map((s) => s.name)).toEqual(["first", "second", "third"]);
}
