import type { EChartsOption } from "echarts";

import type { ForecastBucket, PastForecastBucket, PointAggregateBucket } from "@bms/shared";

import { axisForUnit, shiftCompareBuckets } from "./asset-history-range";
import { forecastPalette, pastForecastPalette, seriesPalette } from "./chart-theme";
import {
  clipForecastToAxis,
  forecastAxisMax,
  forecastIsLive,
  forecastLegendEntries,
  forecastNames,
  forecastSeries,
  pastForecastName,
  pastForecastSeries,
} from "./forecast-series";
import { withoutFloatNoise } from "./telemetry-number";
import type { Roles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

/**
 * The tooltip's value: a number without its binary tail, grouped in thousands as ECharts' own
 * default was (`125,000`); a `[t, v]` pair by its value; ECharts' own `-` for a gap. The band's
 * upper half keeps its own formatter (the true `p10 – p90`). A mean prints every digit the tail
 * rule keeps (`21.3666666667`), where the bucket table rounds means to three decimals.
 */
function tooltipValue(value: unknown): string {
  const v = Array.isArray(value) ? value.at(-1) : value;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return "-";
  }
  return Number(withoutFloatNoise(v)).toLocaleString("en-GB", { maximumFractionDigits: 20 });
}

/** One plotted point: its buckets and, when a compare is on, the previous period's buckets. */
export interface HistorySeriesInput {
  readonly name: string;
  readonly unit: string | null;
  readonly buckets: readonly PointAggregateBucket[];
  /** True timestamps of the previous period; `null`/absent when there is none. */
  readonly compareBuckets?: readonly PointAggregateBucket[] | null;
  /** `E1.4a`: the point's current forecast buckets (from the current hour), or `null`/absent. */
  readonly forecast?: readonly ForecastBucket[] | null;
  /** `E1.4e`: the forecast made 1 h ahead of each past hour in the window, or `null`/absent. */
  readonly pastForecast?: readonly PastForecastBucket[] | null;
}

/**
 * `F4.297` U4 — the asset history chart's option. Pure: nothing here reads the clock
 * (`from` and `to` are epoch ms of the requested window) or mounts ECharts.
 *
 * The x axis is pinned to the window. Series are placed on a left or right y axis by unit
 * (`axisForUnit`); a series whose unit would need a third axis is left out — the page refuses
 * that selection before it gets here. Compare series are dashed and carry timestamps shifted
 * forward by `compare.spanMs`, so they overlay the current window. The series type comes from
 * `CHART_SERIES`, never a literal.
 *
 * **`E1.4a` (ADR 0135 Amendment 3 R-d, C2).** A series that carries a `forecast` adds a band and a
 * dashed p50 (`forecast-series.ts`) — only when `asOf`, the server's instant,
 * says the window is live (N11), and never for a series refused an axis. With a forecast drawn the
 * x axis extends by R8's rule and a "now" line marks `asOf`. A legend lists what is plotted (R9).
 *
 * **`E1.4e` (ADR 0135 Amendment 4).** A series that carries a `pastForecast` adds one dashed line:
 * the forecast made 1 h ahead of each past hour. Unlike the live forecast it is drawn on any
 * window, a past one included, in a colour from the chart's spare series roles
 * (`pastForecastPalette`), so it never shares a colour with an actual line.
 *
 * **`F4.377` (the owner's ruling, 2026-11-16: three colours).** The live forecast's band and p50 no
 * longer take the point's actual colour: they take `forecastPalette`, which shares no colour with
 * the actual or the past palette. Each point's forecast is traced to its point by the legend's
 * point key (R9). With one point: actual `series-1`, past `series-2`, live forecast `series-3`.
 *
 * **`F4.379`.** The tooltip prints a value as the Latest cell does (`withoutFloatNoise`): a stored
 * int16 × 0.1 shows `0.3`, not `0.3000000000000007`, and every real digit stays.
 */
export function buildHistoryChartOption(args: {
  readonly from: number;
  readonly to: number;
  readonly series: readonly HistorySeriesInput[];
  readonly compare: { readonly spanMs: number } | null;
  readonly roles: Roles;
  /** The forecast reads' server instant (epoch ms); `null`/absent draws no forecast. */
  readonly asOf?: number | null;
}): EChartsOption {
  const { from, to, series, compare, roles } = args;
  const asOf = args.asOf ?? null;
  const palette = seriesPalette(roles);
  const seriesType = CHART_SERIES.line.type;
  const units: (string | null)[] = [];
  const plotted: { input: HistorySeriesInput; axis: 0 | 1; colour: string }[] = [];

  for (const input of series) {
    const axis = axisForUnit(units, input.unit);
    if (axis === "refused") {
      continue;
    }
    if (!units.includes(input.unit)) {
      units.push(input.unit);
    }
    plotted.push({ input, axis: axis === "left" ? 0 : 1, colour: palette[plotted.length % palette.length] });
  }

  const data = (buckets: readonly PointAggregateBucket[]) =>
    buckets.map((b) => [b.t, b.v] as [string, number | null]);

  const lines = plotted.flatMap(({ input, axis, colour }) => {
    const current = {
      name: input.name,
      type: seriesType,
      yAxisIndex: axis,
      showSymbol: false,
      itemStyle: { color: colour },
      lineStyle: { color: colour },
      data: data(input.buckets),
    };
    if (compare === null || !input.compareBuckets) {
      return [current];
    }
    return [
      current,
      {
        name: `${input.name} (previous period)`,
        type: seriesType,
        yAxisIndex: axis,
        showSymbol: false,
        itemStyle: { color: colour },
        lineStyle: { color: colour, type: "dashed" as const, opacity: 0.6 },
        data: data(shiftCompareBuckets(input.compareBuckets, compare.spanMs)),
      },
    ];
  });

  const forecasting = forecastIsLive(to, asOf)
    ? plotted.filter(({ input }) => (input.forecast?.length ?? 0) > 0)
    : [];
  const lastBucketMs =
    forecasting.length === 0
      ? null
      : Math.max(...forecasting.map(({ input }) => Date.parse(input.forecast?.at(-1)?.t ?? "")));
  const xMax = forecastAxisMax({ from, to, lastBucketMs });
  const futurePalette = forecastPalette(roles);
  const futureColour = (index: number) => futurePalette[index % futurePalette.length];
  const forecastLines = forecasting.flatMap(({ input, axis }, index) =>
    forecastSeries({
      buckets: clipForecastToAxis(input.forecast ?? [], xMax),
      colour: futureColour(index),
      yAxisIndex: axis,
      names: forecastNames(forecasting.length > 1 ? input.name : null),
      stackId: `forecast-band-${index}`,
    }),
  );
  // "now" sits on the first actual series, so hiding a forecast in the legend never hides it.
  const host =
    forecastLines.length === 0 || asOf === null
      ? lines
      : lines.map((line, index) =>
          index === 0
            ? {
                ...line,
                markLine: {
                  silent: true,
                  symbol: "none",
                  label: { formatter: "now" },
                  lineStyle: { color: roles["ink-faint"], type: "solid" as const },
                  data: [{ xAxis: asOf }],
                },
              }
            : line,
        );
  const pasting = plotted.filter(({ input }) => (input.pastForecast?.length ?? 0) > 0);
  const pastPalette = pastForecastPalette(roles);
  const pastName = (input: HistorySeriesInput) => pastForecastName(pasting.length > 1 ? input.name : null);
  const pastLines = pasting.flatMap(({ input, axis }, index) =>
    pastForecastSeries({
      buckets: input.pastForecast ?? [],
      colour: pastPalette[index % pastPalette.length],
      yAxisIndex: axis,
      name: pastName(input),
    }),
  );
  const all = [...host, ...pastLines, ...forecastLines];
  // The p50 before its band, and the band's two series as one entry (they share the name).
  const legendNames = [
    ...lines.map((line) => line.name),
    ...pasting.map(({ input }) => pastName(input)),
    ...forecasting.flatMap(({ input }, index) =>
      forecastLegendEntries(forecastNames(forecasting.length > 1 ? input.name : null), futureColour(index)),
    ),
  ];

  return {
    color: palette,
    tooltip: { trigger: "axis", valueFormatter: tooltipValue },
    ...(all.length > 0 ? { legend: { type: "scroll" as const, data: legendNames } } : {}),
    xAxis: { type: "time", min: from, max: xMax },
    yAxis: (units.length > 0 ? units : [null]).map((unit) => ({
      type: "value" as const,
      ...(unit ? { name: unit } : {}),
    })),
    series: all,
  };
}
