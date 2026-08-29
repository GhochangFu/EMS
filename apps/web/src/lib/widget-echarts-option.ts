import type { EChartsOption } from "echarts";

import { CHART_SERIES, WIDGET_TONE_COLOR, type ChartConfig, type RadialGaugeConfig, type WidgetSeries } from "./widget-catalog";

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * A radial gauge's ECharts `gauge` series option. Pure — nothing here renders
 * ECharts; `RadialGaugeWidget` is the only caller that mounts a chart.
 *
 * `config.min`/`config.max` are guaranteed `max > min` by
 * `gaugeRangeIsOrdered` on the contract side (`packages/shared/src/
 * contracts/dashboard-builder.ts`) — relied on rather than re-checked here,
 * so this file does not carry a second copy of that rule.
 */
export function buildRadialGaugeOption(config: RadialGaugeConfig, value: number): EChartsOption {
  const { min, max, thresholds = [] } = config;
  const range = max - min;
  const clampedValue = clamp(value, min, max);

  // ECharts axisLine colour stops are ascending [fraction, colour] pairs; a
  // stored threshold is a raw reading value and must be converted, not
  // passed through — raw values would collapse every band into the first 1%
  // of the arc. gaugeThresholdSchema imposes no ordering, so the store can
  // hold an out-of-order array; sorted here rather than trusted. A threshold
  // outside [min, max] is clamped rather than dropped, so a stale config
  // still paints an arc instead of silently losing a band.
  const stops: [number, string][] = [...thresholds]
    .sort((a, b) => a.value - b.value)
    .map((t) => [clamp((t.value - min) / range, 0, 1), WIDGET_TONE_COLOR[t.tone]]);

  // The last stop must reach 1: ECharts leaves everything past the final
  // defined stop unpainted (no error, just a blank arc), so the top band is
  // extended to the end using its own colour rather than left short.
  const lastStop = stops.at(-1);
  const colorStops: [number, string][] =
    stops.length === 0
      ? [[1, WIDGET_TONE_COLOR.ok]]
      : lastStop && lastStop[0] === 1
        ? stops
        : [...stops, [1, lastStop ? lastStop[1] : WIDGET_TONE_COLOR.ok]];

  return {
    series: [
      {
        type: "gauge",
        min,
        max,
        axisLine: { lineStyle: { color: colorStops } },
        // A reading above `max` (or below `min`) must not send the needle
        // outside the widget box — clamped the same way the value driving
        // the axis colours already is.
        data: [{ value: clampedValue }],
      },
    ],
  };
}

/** `chartConfigSchema.windowMinutes`'s documented default — a day, expressed in the unit the config carries. */
const DEFAULT_WINDOW_MINUTES = 1_440;

/**
 * The generic `chart` widget's ECharts option (decision 4). The series *type*
 * is read only from `CHART_SERIES[config.series]` — this function holds no
 * ECharts series-name literal of its own, which is what keeps the
 * plain-label-to-ECharts mapping stated in exactly one place
 * (`tests/f3.1c-widget-series-mapping.test.ts` scans for a second one).
 *
 * `now` is a required parameter, never read from `Date.now()` inside this
 * function — a builder that reads the clock cannot be tested deterministically
 * (the same rule `tests/repo-invariants.test.ts` holds against
 * `schematic-telemetry-context.tsx`, there in the opposite direction: the
 * clock read belongs in the component that calls this, at render, not here).
 */
export function buildChartOption(config: ChartConfig, series: readonly WidgetSeries[], now: number): EChartsOption {
  const seriesShape = CHART_SERIES[config.series];
  const windowMinutes = config.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const xAxisMin = new Date(now - windowMinutes * 60_000).toISOString();

  // The contract permits a negative sortOrder; ignoring order makes legend
  // colours change between reads, since ECharts assigns a series' colour by
  // its position in this array.
  const ordered = [...series].sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    xAxis: { type: "time", min: xAxisMin },
    yAxis: {
      type: "value",
      ...(config.yAxisLabel ? { name: config.yAxisLabel } : {}),
    },
    series: ordered.map((s) => ({
      name: s.name,
      type: seriesShape.type,
      data: s.points.map((p) => [p.t, p.v] as [string, number | null]),
      ...(seriesShape.area ? { areaStyle: {} } : {}),
      ...(config.stacked ? { stack: "f3.1c-widget-stack" } : {}),
    })),
  };
}
