import type { EChartsOption } from "echarts";

import { CHART_SERIES, WIDGET_TONE_COLOR, type ChartConfig, type RadialGaugeConfig, type WidgetSeries } from "./widget-catalog";
import { formatWidgetValue } from "./widget-value";

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

  // ECharts axisLine colour stops are ascending [fraction, colour] pairs,
  // and each stop's colour paints the segment ENDING at its fraction — not
  // starting there. A threshold in this codebase's idiom (the
  // AutomationRuleOperator "gte" reading `thresholdValue`/`severity` already
  // use) means "at or above this value, this tone begins", so the band
  // BEFORE threshold i must carry threshold (i-1)'s tone — or the base "ok"
  // tone before the first threshold — and the band AFTER the last threshold,
  // up to the top of the arc, carries the last threshold's own tone. That is
  // one colour shifted from the threshold that introduces it, which is what
  // keeps a healthy reading on the "ok" band instead of painting the region
  // below the first threshold in that threshold's own (already-elevated)
  // colour. n thresholds therefore produce n+1 stops.
  //
  // A stored threshold is a raw reading value and must be converted to a
  // fraction, not passed through — raw values would collapse every band
  // into the first 1% of the arc. gaugeThresholdSchema imposes no ordering,
  // so the store can hold an out-of-order array; sorted here rather than
  // trusted. A threshold outside [min, max] is clamped rather than dropped,
  // so a stale config still paints an arc instead of silently losing a band.
  const sortedThresholds = [...thresholds].sort((a, b) => a.value - b.value);
  const bandStops: [number, string][] = sortedThresholds.map((t, i) => [
    clamp((t.value - min) / range, 0, 1),
    WIDGET_TONE_COLOR[i === 0 ? "ok" : sortedThresholds[i - 1].tone],
  ]);

  // The last stop must reach 1: ECharts leaves everything past the final
  // defined stop unpainted (no error, just a blank arc), so the top band is
  // extended to the end using the last threshold's own tone rather than
  // left short.
  const colorStops: [number, string][] =
    sortedThresholds.length === 0
      ? [[1, WIDGET_TONE_COLOR.ok]]
      : [...bandStops, [1, WIDGET_TONE_COLOR[sortedThresholds[sortedThresholds.length - 1].tone]]];

  return {
    series: [
      {
        type: "gauge",
        min,
        max,
        axisLine: { lineStyle: { color: colorStops } },
        // ECharts 5.6.0 defaults `detail.show: true` with no `formatter`,
        // which prints the raw number — `commonConfigFields` puts `unit`
        // and `decimals` on every config arm including this one, so a
        // reading of 7.126 on a { unit: "pH", decimals: 1 } gauge must not
        // render "7.126" where the author configured "7.1 pH".
        //
        // The three style keys are not decoration. ECharts 5.6.0 defaults the
        // readout to `fontSize: 30` at `offsetCenter: [0, "40%"]`, which in a
        // 220px widget draws it *across* the dial — the `F3.1c` §4.6 browser
        // pass caught "7.5 bar" overlapping the arc and its own tick labels,
        // and the card then clipped it. `72%` moves it into the open bottom of
        // the gauge, below the arc's ends.
        detail: {
          formatter: (v) => formatWidgetValue(v, { unit: config.unit, decimals: config.decimals }),
          fontSize: 16,
          offsetCenter: [0, "72%"],
        },
        // The default `splitNumber: 10` prints eleven tick labels. On a 6..12
        // range that is "6.6 7.2 7.8 8.4 9 9.6 …", which collides with itself
        // at this size and with the needle. Four splits give five labels.
        splitNumber: 4,
        axisLabel: { fontSize: 9, distance: 12 },
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
    // `series[].name` below is not self-rendering: ECharts draws a key only
    // when the option carries a `legend` component, so a chart bound to five
    // feeders drew five lines with no way to tell them apart. Found on the
    // running stack — the option was correct about the names and silent about
    // showing them, which no assertion on `series[].name` can catch.
    //
    // Only for more than one series. A single-series chart is already named by
    // the widget's own title, and the legend costs a row of a tile that may be
    // one grid cell tall.
    //
    // `type: "scroll"` because the binding cap is MAX_WIDGET_POINTS, not a
    // number that fits on one line — the default legend wraps into the plot
    // and pushes the chart out of the card. The grid reserves the bottom band
    // the legend then occupies; without it ECharts draws the legend over the
    // x-axis labels rather than below them.
    ...(ordered.length > 1
      ? {
          legend: {
            type: "scroll" as const,
            bottom: 0,
            itemWidth: 12,
            itemHeight: 8,
            textStyle: { fontSize: 10 },
            data: ordered.map((s) => s.name),
          },
          grid: { top: 16, left: 8, right: 16, bottom: 28, containLabel: true },
        }
      : {}),
    series: ordered.map((s) => ({
      name: s.name,
      type: seriesShape.type,
      data: s.points.map((p) => [p.t, p.v] as [string, number | null]),
      ...(seriesShape.area ? { areaStyle: {} } : {}),
      ...(config.stacked ? { stack: "f3.1c-widget-stack" } : {}),
    })),
  };
}
