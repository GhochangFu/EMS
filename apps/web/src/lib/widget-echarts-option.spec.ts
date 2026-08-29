import { expect } from "vitest";

import type { RadialGaugeConfig } from "./widget-catalog";
import { WIDGET_TONE_COLOR } from "./widget-catalog";
import { buildRadialGaugeOption } from "./widget-echarts-option";

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

  expect(stops[0]).toEqual([0.6, WIDGET_TONE_COLOR.warning]);
  expect(stops[1]).toEqual([0.8, WIDGET_TONE_COLOR.critical]);
  const last = stops.at(-1);
  expect(
    last?.[0],
    "a missing trailing 1 leaves the arc past the last threshold unpainted, and ECharts does not error on it",
  ).toBe(1);
  for (let i = 1; i < stops.length; i += 1) {
    expect(stops[i][0], "stops must be ascending or ECharts renders nonsense").toBeGreaterThanOrEqual(stops[i - 1][0]);
  }
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
  const config: RadialGaugeConfig = {
    min: 0,
    max: 100,
    thresholds: [{ value: -20, tone: "warning" }],
  };
  const stops = asGauge(buildRadialGaugeOption(config, 50)).series[0].axisLine.lineStyle.color;
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
