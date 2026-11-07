import { expect } from "vitest";

import type { ChartConfig, RadialGaugeConfig, WidgetSeries } from "./widget-catalog";
import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { seriesPalette } from "./chart-theme";
import { resolveRoles } from "./theme";
import { buildChartOption, buildRadialGaugeOption, donutLeftOut, heatmapCells, heatmapDays } from "./widget-echarts-option";

/** `F3.65c` — the light roles from the real `index.css`; a band stop is a resolved role (OQ1). */
const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));

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
      readonly detail: {
        readonly formatter: (value: number) => string;
        readonly fontSize: number;
        readonly offsetCenter: readonly [number, string];
      };
      readonly splitNumber: number;
    },
  ];
};

function asGauge(option: unknown): GaugeOptionShape {
  return option as unknown as GaugeOptionShape;
}

export function gaugePutsMinMaxOnTheSeriesAndValueInData(): void {
  const option = asGauge(buildRadialGaugeOption({ min: 0, max: 100 }, 42, roles));
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
  const stops = asGauge(buildRadialGaugeOption(config, 50, roles)).series[0].axisLine.lineStyle.color;

  // Each ECharts stop paints the segment ENDING at its fraction. A
  // threshold means "at or above this value, the tone begins" (the
  // AutomationRuleOperator "gte" reading), so the band below the first
  // threshold must stay "ok" — painting it "warning" instead is exactly
  // the bug this pins: a healthy reading would sit on an elevated band.
  expect(stops[0], "the band before the first threshold must be the base ok tone, not the threshold's own").toEqual([
    0.6,
    roles.accent,
  ]);
  expect(stops[1]).toEqual([0.8, roles.warning]);
  expect(stops[2]).toEqual([1, roles.critical]);
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
  const option = asGauge(buildRadialGaugeOption(config, 7, roles));
  const series = option.series[0];

  expect(series.min, "a hardcoded series.min=0 would pass every other fixture in this file").toBe(6);
  expect(series.max).toBe(8);

  const stops = series.axisLine.lineStyle.color;
  expect(
    stops[0],
    "(7.5 - 6) / 2 = 0.75; the un-offset (7.5 / 2 = 3.75, clamped to 1) is the defect this pins",
  ).toEqual([0.75, roles.accent]);
  expect(stops[1]).toEqual([1, roles.warning]);
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
    asGauge(buildRadialGaugeOption(outOfOrder, 50, roles)).series[0].axisLine.lineStyle.color,
    "gaugeThresholdSchema imposes no ordering, so the store can hold [80,60] — unsorted stops make ECharts drop the arc silently",
  ).toEqual(asGauge(buildRadialGaugeOption(ordered, 50, roles)).series[0].axisLine.lineStyle.color);
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
  const stops = asGauge(buildRadialGaugeOption(config, 7, roles)).series[0].axisLine.lineStyle.color;
  expect(stops.length, "a threshold outside [min,max] must still produce a stop, not vanish").toBeGreaterThan(0);
  expect(stops[0][0]).toBe(0);
}

/**
 * ECharts 5.6.0 defaults `detail.show: true` with no `formatter`, printing
 * the raw number. `commonConfigFields` puts `unit`/`decimals` on every
 * config arm including the gauge's, so a { min: 0, max: 14, unit: "pH",
 * decimals: 1 } gauge reading 7.126 must render "7.1 pH", not "7.126".
 */
export function gaugeDetailFormatsTheReadingWithUnitAndDecimals(): void {
  const config: RadialGaugeConfig = { min: 0, max: 14, unit: "pH", decimals: 1 };
  const formatter = asGauge(buildRadialGaugeOption(config, 7.126, roles)).series[0].detail.formatter;
  expect(formatter(7.126), "the raw ECharts default renders the unformatted float on the gauge face").toBe("7.1 pH");
}

/**
 * The readout sits below the dial, and the axis is not over-labelled.
 *
 * Both are ECharts defaults this option deliberately overrides, and both were
 * found by eye in the `F3.1c` §4.6 browser pass rather than by any assertion
 * here: `detail` defaults to `fontSize: 30` at `offsetCenter: [0, "40%"]`,
 * which drew "7.5 bar" across the arc and its own tick labels, and
 * `splitNumber` defaults to 10, which printed eleven crowded labels on a
 * six-unit range. Deleting either override restores an overlap no other test
 * in this file can see, so the overrides are pinned rather than left to a
 * comment.
 */
export function gaugeReadoutClearsTheDialAndTheAxisIsNotOverLabelled(): void {
  const series = asGauge(buildRadialGaugeOption({ min: 6, max: 12, unit: "bar", decimals: 1 }, 7.5, roles)).series[0];

  const offsetY = series.detail.offsetCenter[1];
  expect(
    Number.parseFloat(offsetY),
    `the readout must sit below the dial's centre, not across it; ECharts' own default is "40%"`,
  ).toBeGreaterThanOrEqual(60);
  expect(offsetY.endsWith("%"), "offsetCenter takes a percentage of the gauge radius, not a raw number").toBe(true);
  expect(series.detail.fontSize, "30 (the ECharts default) is wider than the dial's open bottom").toBeLessThanOrEqual(
    18,
  );
  expect(series.splitNumber, "the default 10 prints eleven tick labels, which collide at this size").toBeLessThanOrEqual(
    5,
  );
}

export function gaugeNeedleValueIsClampedIntoRange(): void {
  const config: RadialGaugeConfig = { min: 0, max: 100 };
  expect(
    asGauge(buildRadialGaugeOption(config, 150, roles)).series[0].data[0].value,
    "a reading above max must not send the needle outside the widget box",
  ).toBe(100);
  expect(asGauge(buildRadialGaugeOption(config, -10, roles)).series[0].data[0].value).toBe(0);
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
  readonly legend?: { readonly data: readonly string[]; readonly type?: string };
  readonly grid?: { readonly bottom?: number; readonly containLabel?: boolean };
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

function threeChartSeries(): readonly WidgetSeries[] {
  return [
    { name: "third", sortOrder: 5, points: [] },
    { name: "first", sortOrder: -2, points: [] },
    { name: "second", sortOrder: 0, points: [] },
  ];
}

export function chartLineSeriesHasNoAreaStyle(): void {
  const config: ChartConfig = { series: "line" };
  const option = asChart(buildChartOption(config, oneChartSeries(), CHART_NOW, roles));
  const out = option.series[0];
  expect(out.type).toBe("line");
  expect(out.areaStyle, "'line' must not carry areaStyle, or it silently renders filled").toBeUndefined();

  // Neither the data tuple's order nor the x-axis kind was asserted
  // anywhere else in this file: [String(p.v), p.t] instead of [p.t, p.v],
  // or xAxis: { type: "category" } instead of "time", would land every
  // sample at the wrong coordinate on the wrong axis kind and stay green.
  expect(
    out.data[0],
    "the tuple must be [timestamp, value] — a swapped pair lands every point at the wrong coordinate",
  ).toEqual(["2026-08-29T11:00:00.000Z", 1]);
  expect(
    option.xAxis.type,
    "a time series plotted on a 'category' axis reads as evenly-spaced ticks rather than real elapsed time",
  ).toBe("time");
}

/** This is decision 4's entire payload. `area` is not an ECharts series type — it is `line` plus `areaStyle`. */
export function chartAreaSeriesIsLineWithAreaStyle(): void {
  const config: ChartConfig = { series: "area" };
  const out = asChart(buildChartOption(config, oneChartSeries(), CHART_NOW, roles)).series[0];
  expect(out.type, "'area' is not an ECharts series type — it is line + areaStyle").toBe("line");
  expect(out.areaStyle).toBeDefined();
}

export function chartBarAndScatterMapDirectly(): void {
  expect(asChart(buildChartOption({ series: "bar" }, oneChartSeries(), CHART_NOW, roles)).series[0].type).toBe("bar");
  expect(asChart(buildChartOption({ series: "scatter" }, oneChartSeries(), CHART_NOW, roles)).series[0].type).toBe(
    "scatter",
  );
}

/**
 * "Every series" means every series — a fixture of one cannot tell "sets
 * stack on series[0]" apart from "sets stack on every series", so this uses
 * the same three-series fixture `chartNSeriesProduceNEntriesOrderedBySortOrder`
 * builds below.
 */
export function chartStackedSetsStackOnEverySeriesAbsentSetsNone(): void {
  const stacked = asChart(buildChartOption({ series: "line", stacked: true }, threeChartSeries(), CHART_NOW, roles)).series;
  expect(stacked).toHaveLength(3);
  for (const s of stacked) {
    expect(s.stack, `${s.name}: overlapping series read as one wrong total without a shared stack key`).toBeDefined();
  }

  const unstacked = asChart(buildChartOption({ series: "line" }, threeChartSeries(), CHART_NOW, roles)).series;
  for (const s of unstacked) {
    expect(s.stack).toBeUndefined();
  }
}

export function chartYAxisLabelSetsNameAbsentOmitsIt(): void {
  const labelled = asChart(buildChartOption({ series: "line", yAxisLabel: "kW" }, oneChartSeries(), CHART_NOW, roles));
  expect(labelled.yAxis.name).toBe("kW");

  const unlabelled = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW, roles));
  expect(unlabelled.yAxis.name, "a configured label must not silently vanish").toBeUndefined();
}

export function chartWindowMinutesSetsTheXAxisLowerBoundRelativeToNow(): void {
  const withWindow = asChart(
    buildChartOption({ series: "line", windowMinutes: 60 }, oneChartSeries(), CHART_NOW, roles),
  );
  expect(withWindow.xAxis.min).toBe(new Date(CHART_NOW - 60 * 60_000).toISOString());

  const defaulted = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW, roles));
  expect(
    defaulted.xAxis.min,
    "absent windowMinutes must fall back to the documented day, not 'all data' — a widget configured for a day must not show a year",
  ).toBe(new Date(CHART_NOW - 1_440 * 60_000).toISOString());
}

export function chartNSeriesProduceNEntriesOrderedBySortOrder(): void {
  const out = asChart(buildChartOption({ series: "line" }, threeChartSeries(), CHART_NOW, roles)).series;
  expect(out.map((s) => s.name)).toEqual(["first", "second", "third"]);
}

/**
 * A multi-series chart must name its series on the face of the widget.
 *
 * `series[].name` alone does nothing visible: ECharts draws no legend unless
 * the option carries a `legend` component, so five feeder bindings rendered as
 * five indistinguishable lines and the reader had no way to tell which was
 * which. Found on the running stack, not by this suite — the option was
 * *correct* about names and silent about showing them, which is why the
 * assertion is on `legend.data` rather than on `series[].name` again.
 *
 * The legend is ordered like the series, and for the same reason: ECharts
 * assigns a series' colour by its position, so a legend in any other order
 * labels the wrong colour.
 */
export function chartLegendNamesEverySeriesInOrderWhenThereIsMoreThanOne(): void {
  const option = asChart(buildChartOption({ series: "line" }, threeChartSeries(), CHART_NOW, roles));
  expect(
    option.legend,
    "series[].name draws nothing without a legend component — five lines in one colour order with no key",
  ).toBeDefined();
  expect(
    option.legend?.data,
    "a legend ordered differently from the series labels the wrong colour",
  ).toEqual(["first", "second", "third"]);
  expect(
    option.grid?.bottom,
    "a bottom legend with no grid reservation is drawn over the x-axis labels",
  ).toBeGreaterThan(0);
}

/**
 * One series needs no legend: the widget's own title already names it, and the
 * legend costs a row of a tile that is only a few grid cells tall.
 */
export function chartSingleSeriesGetsNoLegend(): void {
  const option = asChart(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW, roles));
  expect(
    option.legend,
    "a one-series legend repeats the widget title and eats the plot's height",
  ).toBeUndefined();
}

/**
 * `F3.65c` (plan D1) — the generic chart carries its series colours from the roles, the same
 * palette the ECharts theme holds, so a toggle changes both together.
 */
export function chartSeriesColoursAreTheRolePalette(): void {
  const option = buildChartOption({ series: "line" }, threeChartSeries(), CHART_NOW, roles) as { color?: unknown };
  expect(option.color).toEqual(seriesPalette(roles));
}

/**
 * `F4.322` (ADR 0047 Amendment 7) — the three new kinds. Read back through a loose shape: the
 * category and pie options do not fit `ChartOptionShape`'s time axis.
 */
type LooseOption = {
  readonly xAxis?: { readonly type: string; readonly name?: string };
  readonly yAxis?: { readonly type: string; readonly data?: readonly string[]; readonly inverse?: boolean };
  readonly legend?: unknown;
  readonly series: readonly {
    readonly type: string;
    readonly step?: string;
    readonly stack?: string;
    readonly radius?: readonly string[];
    readonly colorBy?: string;
    readonly data: readonly unknown[];
  }[];
};

const loose = (option: unknown): LooseOption => option as LooseOption;

function valuedSeries(): readonly WidgetSeries[] {
  return [
    { name: "Pump B · kw", sortOrder: 1, points: [], value: 30 },
    { name: "Pump A · kw", sortOrder: 0, points: [], value: 10 },
    { name: "Pump C · kw", sortOrder: 2, points: [], value: null },
    { name: "Pump D · kw", sortOrder: 3, points: [], value: -4 },
  ];
}

export function chartStepHoldsTheValueUntilTheNextSample(): void {
  const option = loose(buildChartOption({ series: "step", stacked: true }, oneChartSeries(), CHART_NOW, roles));
  expect(option.series[0]?.type).toBe("line");
  expect(option.series[0]?.step, "a run state holds until the next sample, so the step is at the end").toBe("end");
  expect(option.series[0]?.stack, "step keeps the time kinds' stacked flag").toBeDefined();
  expect(option.xAxis?.type).toBe("time");
  expect(loose(buildChartOption({ series: "line" }, oneChartSeries(), CHART_NOW, roles)).series[0]?.step).toBeUndefined();
}

export function chartCompareDrawsOneHorizontalBarPerPointInOrder(): void {
  const option = loose(
    buildChartOption({ series: "compare", aggregate: "sum", yAxisLabel: "kWh", stacked: true }, valuedSeries(), CHART_NOW, roles),
  );
  expect(option.yAxis?.type, "the points are the categories").toBe("category");
  expect(option.yAxis?.data).toEqual(["Pump A · kw", "Pump B · kw", "Pump C · kw", "Pump D · kw"]);
  expect(option.yAxis?.inverse, "the first point reads at the top").toBe(true);
  expect(option.xAxis?.type).toBe("value");
  expect(option.xAxis?.name, "yAxisLabel names the value axis").toBe("kWh");
  expect(option.series).toHaveLength(1);
  expect(option.series[0]?.type).toBe("bar");
  expect(option.series[0]?.data).toEqual([10, 30, null, -4]);
  expect(option.series[0]?.stack, "stacked means nothing on one bar per point").toBeUndefined();
  expect(option.series[0]?.colorBy, "each bar takes its own palette colour").toBe("data");
  expect(option.legend, "the axis names every bar, so no legend").toBeUndefined();
}

export function chartDonutDrawsOnePositiveSlicePerPoint(): void {
  const option = loose(buildChartOption({ series: "donut", aggregate: "sum" }, valuedSeries(), CHART_NOW, roles));
  expect(option.xAxis, "a donut has no axes").toBeUndefined();
  expect(option.yAxis).toBeUndefined();
  expect(option.series[0]?.type).toBe("pie");
  expect(option.series[0]?.radius, "an inner radius makes it a ring").toEqual(["50%", "75%"]);
  const palette = seriesPalette(roles);
  expect(option.series[0]?.data, "null and non-positive numbers have no share; colour is the point's place").toEqual([
    { name: "Pump A · kw", value: 10, itemStyle: { color: palette[0] } },
    { name: "Pump B · kw", value: 30, itemStyle: { color: palette[1] } },
  ]);
  // A point before the others with no share keeps their colours where they were.
  const shifted = loose(
    buildChartOption(
      { series: "donut", aggregate: "sum" },
      [{ name: "Pump 0 · kw", sortOrder: -1, points: [], value: null }, ...valuedSeries()],
      CHART_NOW,
      roles,
    ),
  );
  expect((shifted.series[0]?.data[0] as { itemStyle: { color: string } }).itemStyle.color).toBe(palette[1]);
}

export function donutLeftOutCountsThePointsWithNoShare(): void {
  expect(donutLeftOut(valuedSeries())).toBe(2);
  expect(donutLeftOut([{ name: "pending", sortOrder: 0, points: [] }]), "an unanswered read is not 'no value'").toBe(0);
  expect(donutLeftOut([{ name: "a", sortOrder: 0, points: [], value: 1 }])).toBe(0);
}

/**
 * `F4.322` PR 2 (ADR 0047 Amendment 7 item 5) — the heatmap: local days across, local hours
 * down, in the response's zone, never the browser's.
 */
export function heatmapCellsAreLocalDayAndHour(): void {
  // Hourly buckets start on the UTC hour. Kolkata is +05:30, so 18:00Z is 23:30 local: hour 23.
  const points = [
    { t: "2026-11-01T18:00:00.000Z", v: 3 },
    { t: "2026-11-01T19:00:00.000Z", v: 5 }, // 2026-11-02 00:30 local
    { t: "2026-11-01T20:00:00.000Z", v: null }, // no sample: no cell
  ];
  expect(heatmapCells(points, "Asia/Kolkata")).toEqual([
    { day: "2026-11-01", hour: 23, value: 3 },
    { day: "2026-11-02", hour: 0, value: 5 },
  ]);
  expect(heatmapCells(points.slice(0, 1), "Etc/UTC")).toEqual([{ day: "2026-11-01", hour: 18, value: 3 }]);
}

/** A fall-back hour holds two buckets: one cell, by the widget's function. */
export function heatmapMergesARepeatedLocalHour(): void {
  // Europe/London, 2026-10-25: 00:00Z and 01:00Z are both 01:00 local.
  const fallBack = [
    { t: "2026-10-25T00:00:00.000Z", v: 2 },
    { t: "2026-10-25T01:00:00.000Z", v: 6 },
  ];
  const one = (fn: "sum" | "avg" | "min" | "max") => heatmapCells(fallBack, "Europe/London", fn);
  expect(one("sum")).toEqual([{ day: "2026-10-25", hour: 1, value: 8 }]);
  expect(one("avg")).toEqual([{ day: "2026-10-25", hour: 1, value: 4 }]);
  expect(one("min")[0]?.value).toBe(2);
  expect(one("max")[0]?.value).toBe(6);
}

/** A day with only null buckets is still a column on the axis. */
export function heatmapKeepsAnEmptyDay(): void {
  const points = [
    { t: "2026-11-01T05:00:00.000Z", v: 1 },
    { t: "2026-11-02T05:00:00.000Z", v: null },
    { t: "2026-11-03T05:00:00.000Z", v: 2 },
  ];
  expect(heatmapDays(points, "Etc/UTC")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
}

type HeatmapShape = {
  readonly xAxis: { readonly type: string; readonly data: readonly string[] };
  readonly yAxis: { readonly type: string; readonly data: readonly string[] };
  readonly visualMap: { readonly min: number; readonly max: number; readonly inRange: { readonly color: readonly string[] } };
  readonly series: readonly { readonly type: string; readonly data: readonly (readonly [number, number, number])[] }[];
};

export function chartHeatmapDrawsDaysAcrossAndHoursDown(): void {
  const series: readonly WidgetSeries[] = [
    {
      name: "P-01 · kw",
      sortOrder: 0,
      points: [
        { t: "2026-11-02T01:00:00.000Z", v: 8 },
        { t: "2026-11-01T05:00:00.000Z", v: 2 },
      ],
    },
  ];
  const option = buildChartOption(
    { series: "heatmap", aggregate: "avg", windowMinutes: 10_080, stacked: true },
    series,
    CHART_NOW,
    roles,
    "Etc/UTC",
  ) as unknown as HeatmapShape;
  expect(option.xAxis.type).toBe("category");
  expect(option.xAxis.data, "days in order").toEqual(["2026-11-01", "2026-11-02"]);
  expect(option.yAxis.data).toHaveLength(24);
  expect(option.yAxis.data[0]).toBe("00:00");
  expect(option.series[0]?.type).toBe("heatmap");
  expect(option.series[0]?.data).toEqual([
    [1, 1, 8],
    [0, 5, 2],
  ]);
  expect(option.visualMap.min).toBe(2);
  expect(option.visualMap.max).toBe(8);
  expect(option.visualMap.inRange.color.at(-1), "one hue, the accent").toBe(roles.accent);
}
