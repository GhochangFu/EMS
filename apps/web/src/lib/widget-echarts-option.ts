import type { EChartsOption } from "echarts";

import { WIDGET_TONE_COLOR, type RadialGaugeConfig } from "./widget-catalog";

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
