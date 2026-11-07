import type { EChartsOption } from "echarts";

import type { PointAggregateFunction } from "@bms/shared";

import { seriesPalette } from "./chart-theme";
import { withAlpha, type Roles } from "./theme";
import {
  CHART_SERIES,
  widgetToneColor,
  type ChartConfig,
  type RadialGaugeConfig,
  type WidgetSeries,
} from "./widget-catalog";
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
 *
 * `roles` is required, not optional (`F3.65c`): the band stops are the tones' resolved roles for
 * the current theme, and an optional parameter at this adapter would let a caller fall back to a
 * default no compiler or fake would notice.
 */
export function buildRadialGaugeOption(config: RadialGaugeConfig, value: number, roles: Roles): EChartsOption {
  const { min, max, thresholds = [] } = config;
  const toneColor = widgetToneColor(roles);
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
    toneColor[i === 0 ? "ok" : sortedThresholds[i - 1].tone],
  ]);

  // The last stop must reach 1: ECharts leaves everything past the final
  // defined stop unpainted (no error, just a blank arc), so the top band is
  // extended to the end using the last threshold's own tone rather than
  // left short.
  const colorStops: [number, string][] =
    sortedThresholds.length === 0
      ? [[1, toneColor.ok]]
      : [...bandStops, [1, toneColor[sortedThresholds[sortedThresholds.length - 1].tone]]];

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

/**
 * `F4.325` (ADR 0047 Amendment 8 item 1) — the colour of each point, by its position in
 * `sortOrder`: `config.colors[i]`'s role when set, else the default palette's colour for that
 * place (`seriesPalette`, wrapping), so a chart with no `colors` is exactly today's. Without
 * `colors` this IS the palette, unchanged; with them it is one entry per point (at least one), so
 * ECharts' by-index `color` reads the right one for a series, a compare bar or a donut slice.
 */
export function chartPointColors(config: Pick<ChartConfig, "colors">, count: number, roles: Roles): string[] {
  const palette = seriesPalette(roles);
  const colors = config.colors;
  if (!colors || colors.length === 0) {
    return palette;
  }
  return Array.from({ length: Math.max(count, 1) }, (_, i) => {
    const role = colors[i];
    return role ? roles[role] : (palette[i % palette.length] as string);
  });
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
 *
 * `roles` (`F3.65c`, required for the same reason as the gauge's) gives the series colours, the
 * same palette `echartsTheme` holds, so a theme toggle changes the option and the theme together.
 */
export function buildChartOption(
  config: ChartConfig,
  series: readonly WidgetSeries[],
  now: number,
  roles: Roles,
  /** `F4.323` — the zone a heatmap's hours and days are in: the response's, else `Etc/UTC`. */
  timeZone: string = "Etc/UTC",
): EChartsOption {
  const seriesShape = CHART_SERIES[config.series];
  // The contract permits a negative sortOrder; ignoring order makes legend
  // colours change between reads, since ECharts assigns a series' colour by
  // its position in this array.
  const ordered = [...series].sort((a, b) => a.sortOrder - b.sortOrder);

  // `F4.323` (ADR 0047 Amendment 7) — the two kinds that draw one number per point.
  if (seriesShape.axis === "category") {
    return compareOption(config, seriesShape, ordered, roles);
  }
  if (seriesShape.axis === "none") {
    return donutOption(config, seriesShape, ordered, roles);
  }
  if (seriesShape.axis === "grid") {
    return heatmapOption(config, seriesShape, ordered[0]?.points ?? [], roles, timeZone);
  }
  if (seriesShape.axis === "matrix") {
    return matrixOption(config, seriesShape, ordered, now, roles, timeZone);
  }

  const windowMinutes = config.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const xAxisMin = new Date(now - windowMinutes * 60_000).toISOString();

  return {
    color: chartPointColors(config, ordered.length, roles),
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
      ...(seriesShape.step ? { step: seriesShape.step } : {}),
      ...(config.stacked ? { stack: "f3.1c-widget-stack" } : {}),
    })),
  };
}

/** A value tooltip in the config's own unit and decimals. */
function valueFormatter(config: ChartConfig): (value: unknown) => string {
  return (value) =>
    formatWidgetValue(typeof value === "number" ? value : null, { unit: config.unit, decimals: config.decimals });
}

/**
 * `F4.323` — `compare`: one horizontal bar per point, the point's window aggregate, in
 * `sortOrder` from the top. One series, so `stacked` means nothing and is not applied; each bar
 * takes its own palette colour (`colorBy: "data"`), and the category axis names them, so no
 * legend is drawn. `yAxisLabel` names the value axis, which is the horizontal one here.
 */
function compareOption(
  config: ChartConfig,
  shape: (typeof CHART_SERIES)["compare"],
  ordered: readonly WidgetSeries[],
  roles: Roles,
): EChartsOption {
  return {
    color: chartPointColors(config, ordered.length, roles),
    tooltip: { trigger: "item", valueFormatter: valueFormatter(config) },
    grid: { top: 16, left: 8, right: 24, bottom: 8, containLabel: true },
    xAxis: { type: "value", ...(config.yAxisLabel ? { name: config.yAxisLabel } : {}) },
    yAxis: {
      type: "category",
      inverse: true,
      data: ordered.map((s) => s.name),
      axisLabel: { fontSize: 10 },
    },
    series: [
      {
        type: shape.type,
        colorBy: "data",
        data: ordered.map((s) => s.value ?? null),
      },
    ],
  };
}

/** A point's share needs a positive number: `null`, zero or negative is left out of the ring. */
function hasShare(s: WidgetSeries): boolean {
  return typeof s.value === "number" && s.value > 0;
}

/**
 * `F4.323` — how many ANSWERED points a donut leaves out (no share); the renderer says so under
 * it. A point whose read has not answered (`value` absent) is not counted: nothing measured it.
 */
export function donutLeftOut(series: readonly WidgetSeries[]): number {
  return series.filter((s) => s.value !== undefined && !hasShare(s)).length;
}

/**
 * `F4.323` — `donut`: one slice per point with a positive window aggregate, each labelled with
 * its share of the total. No axes, so `yAxisLabel` and `stacked` are not read.
 */
function donutOption(
  config: ChartConfig,
  shape: (typeof CHART_SERIES)["donut"],
  ordered: readonly WidgetSeries[],
  roles: Roles,
): EChartsOption {
  const palette = chartPointColors(config, ordered.length, roles);
  return {
    color: palette,
    tooltip: { trigger: "item", valueFormatter: valueFormatter(config) },
    legend: {
      type: "scroll",
      bottom: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: shape.type,
        radius: ["50%", "75%"],
        center: ["50%", "45%"],
        avoidLabelOverlap: true,
        label: { formatter: "{d}%", fontSize: 10 },
        // Each slice's colour is its point's place in `ordered`, set before the filter, so a point
        // that gains or loses its share never shifts the others' colours, and a point keeps the
        // colour a compare chart gives it.
        data: ordered.flatMap((s, i) =>
          hasShare(s) && typeof s.value === "number"
            ? [{ name: s.name, value: s.value, itemStyle: { color: palette[i % palette.length] } }]
            : [],
        ),
      },
    ],
  };
}

/** One heatmap cell: a bucket's local day (`YYYY-MM-DD`) and hour (0–23) in the view's zone. */
export type HeatmapCell = { readonly day: string; readonly hour: number; readonly value: number };

/** A bucket's local day (`YYYY-MM-DD`) and hour (0–23) in `timeZone`. */
function localDayHour(format: Intl.DateTimeFormat, t: string): { day: string; hour: number } {
  const parts = Object.fromEntries(format.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** `en-CA` formats a date as `YYYY-MM-DD`; `h23` keeps midnight at 0, not 24. */
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
}

/** How two buckets that fall in one local hour (a daylight-saving fall-back) become one cell. */
function mergeOf(fn: PointAggregateFunction | undefined): (a: number, b: number) => number {
  if (fn === "sum") return (a, b) => a + b;
  if (fn === "min") return Math.min;
  if (fn === "max") return Math.max;
  // `avg`: the mean of the two hourly averages. The buckets carry no sample counts here, so this
  // is an equal weighting of the two hours, which is exact whenever both hours were sampled at
  // the same rate — the case for a polled meter.
  return (a, b) => (a + b) / 2;
}

/**
 * `F4.323` PR 2 — the hourly buckets as cells in `timeZone` (ADR 0047 Amendment 7 item 5): the
 * asset's site zone from the response, never the browser's. A `null` bucket has no samples and
 * no cell. On a daylight-saving fall-back two buckets share one local hour; they become one cell
 * by the widget's own function (`sum` adds them, the energy heatmap's rule; see `mergeOf`).
 */
export function heatmapCells(
  points: readonly { t: string; v: number | null }[],
  timeZone: string,
  fn?: PointAggregateFunction,
): HeatmapCell[] {
  const format = zoneFormat(timeZone);
  const merge = mergeOf(fn);
  const byCell = new Map<string, HeatmapCell>();
  for (const point of points) {
    if (point.v === null) continue;
    const { day, hour } = localDayHour(format, point.t);
    const key = `${day}|${hour}`;
    const was = byCell.get(key);
    byCell.set(key, { day, hour, value: was ? merge(was.value, point.v) : point.v });
  }
  return [...byCell.values()];
}

/**
 * `F4.323` PR 2 — every local day the window covers, from EVERY bucket, `null` ones included (the
 * read fills each hour of the window), so a day with no samples is an empty column rather than
 * missing from the axis.
 */
export function heatmapDays(points: readonly { t: string }[], timeZone: string): string[] {
  const format = zoneFormat(timeZone);
  return [...new Set(points.map((point) => localDayHour(format, point.t).day))].sort();
}

const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/**
 * `F4.323` PR 2 — `heatmap`: local days across, local hours down, for the one bound point. One
 * hue (`accent`) from 8 % alpha at the lowest cell to full at the highest, the
 * `energy-heatmap.tsx` precedent (no new colour token). `stacked` and `yAxisLabel` are not read.
 */
function heatmapOption(
  config: ChartConfig,
  shape: (typeof CHART_SERIES)["heatmap"],
  points: readonly { t: string; v: number | null }[],
  roles: Roles,
  timeZone: string,
): EChartsOption {
  const cells = heatmapCells(points, timeZone, config.aggregate);
  const days = heatmapDays(points, timeZone);
  const dayIndex = new Map(days.map((day, i) => [day, i]));
  const values = cells.map((c) => c.value);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const format = valueFormatter(config);
  const hue = config.colors?.[0] ? roles[config.colors[0]] : roles.accent;
  return {
    grid: { left: 44, right: 12, top: 8, bottom: 56 },
    tooltip: {
      position: "top",
      formatter: (params) => {
        const value = (params as { value?: [number, number, number] }).value;
        return value ? `${days[value[0]]} ${hourLabel(value[1])} · ${format(value[2])}` : "";
      },
    },
    xAxis: { type: "category", data: days, axisLabel: { fontSize: 10 } },
    yAxis: { type: "category", data: Array.from({ length: 24 }, (_, hour) => hourLabel(hour)), axisLabel: { fontSize: 9 } },
    visualMap: {
      type: "continuous",
      min,
      max: max > min ? max : min + 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 80,
      textStyle: { fontSize: 10 },
      // `F4.325` — the scale's hue is the first point's chosen colour, else the accent.
      inRange: { color: [withAlpha(hue, 0.08), hue] },
    },
    series: [
      {
        type: shape.type,
        data: cells.flatMap((c) => {
          const x = dayIndex.get(c.day);
          return x === undefined ? [] : [[x, c.hour, c.value] as [number, number, number]];
        }),
      },
    ],
  };
}

/** `F4.325` — one matrix column: a local hour, keyed `YYYY-MM-DD|H` like a heatmap cell. */
export type MatrixHour = { readonly key: string; readonly day: string; readonly label: string };

/**
 * `F4.325` (ADR 0047 Amendment 8 item 2) — the 24 local clock hours that end with the one `now`
 * is in, oldest first, in `timeZone`. The last is the hour in progress. An hour repeated by a
 * daylight-saving fall-back is one column, so that day shows 23.
 */
export function matrixHours(now: number, timeZone: string): MatrixHour[] {
  const format = zoneFormat(timeZone);
  const hours: MatrixHour[] = [];
  for (let back = 23; back >= 0; back -= 1) {
    const { day, hour } = localDayHour(format, new Date(now - back * 3_600_000).toISOString());
    const key = `${day}|${hour}`;
    if (hours.at(-1)?.key !== key) hours.push({ key, day, label: hourLabel(hour) });
  }
  return hours;
}

/**
 * `F4.325` — a point's minute buckets folded into local hours by the widget's function: `sum`
 * adds, `min`/`max` take the least/greatest, `avg` is the mean of the minutes that have a value
 * (each sampled minute weighs the same — exact for a polled point, ADR 0047 Amendment 8 item 2).
 * A minute with no value is skipped; an hour with none has no cell.
 */
export function matrixCells(
  points: readonly { t: string; v: number | null }[],
  timeZone: string,
  fn?: PointAggregateFunction,
): Map<string, number> {
  const format = zoneFormat(timeZone);
  const folded = new Map<string, { total: number; count: number; least: number; most: number }>();
  for (const point of points) {
    if (point.v === null) continue;
    const { day, hour } = localDayHour(format, point.t);
    const key = `${day}|${hour}`;
    const was = folded.get(key);
    folded.set(
      key,
      was
        ? { total: was.total + point.v, count: was.count + 1, least: Math.min(was.least, point.v), most: Math.max(was.most, point.v) }
        : { total: point.v, count: 1, least: point.v, most: point.v },
    );
  }
  const cells = new Map<string, number>();
  for (const [key, cell] of folded) {
    cells.set(key, fn === "sum" ? cell.total : fn === "min" ? cell.least : fn === "max" ? cell.most : cell.total / cell.count);
  }
  return cells;
}

/**
 * `F4.325` — `matrix`: the bound points down (in `sortOrder`, the first at the top), the last 24
 * local hours across, each cell the point's hour by `config.aggregate`. One hue for every row —
 * `colors[0]` or the accent — from 8 % alpha to full, as the heatmap. `stacked` and `yAxisLabel`
 * are not read.
 */
function matrixOption(
  config: ChartConfig,
  shape: (typeof CHART_SERIES)["matrix"],
  ordered: readonly WidgetSeries[],
  now: number,
  roles: Roles,
  timeZone: string,
): EChartsOption {
  const hours = matrixHours(now, timeZone);
  const column = new Map(hours.map((hour, i) => [hour.key, i]));
  const data: [number, number, number][] = [];
  ordered.forEach((series, row) => {
    for (const [key, value] of matrixCells(series.points, timeZone, config.aggregate)) {
      const x = column.get(key);
      if (x !== undefined) data.push([x, row, value]);
    }
  });
  data.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const values = data.map((cell) => cell[2]);
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const format = valueFormatter(config);
  const hue = config.colors?.[0] ? roles[config.colors[0]] : roles.accent;
  const names = ordered.map((series) => series.name);
  return {
    grid: { left: 8, right: 12, top: 8, bottom: 56, containLabel: true },
    tooltip: {
      position: "top",
      formatter: (params) => {
        const value = (params as { value?: [number, number, number] }).value;
        // The day too: a spring-forward window shows one `HH:00` twice.
        const hour = value ? hours[value[0]] : undefined;
        return value && hour ? `${names[value[1]]} · ${hour.day} ${hour.label} · ${format(value[2])}` : "";
      },
    },
    xAxis: { type: "category", data: hours.map((hour) => hour.label), axisLabel: { fontSize: 9 } },
    yAxis: { type: "category", inverse: true, data: names, axisLabel: { fontSize: 9 } },
    visualMap: {
      type: "continuous",
      min,
      max: max > min ? max : min + 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 80,
      textStyle: { fontSize: 10 },
      inRange: { color: [withAlpha(hue, 0.08), hue] },
    },
    series: [{ type: shape.type, data }],
  };
}

