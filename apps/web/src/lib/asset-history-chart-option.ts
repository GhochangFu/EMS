import type { EChartsOption } from "echarts";

import type { PointAggregateBucket } from "@bms/shared";

import { axisForUnit, shiftCompareBuckets } from "./asset-history-range";
import { seriesPalette } from "./chart-theme";
import type { Roles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

/** One plotted point: its buckets and, when a compare is on, the previous period's buckets. */
export interface HistorySeriesInput {
  readonly name: string;
  readonly unit: string | null;
  readonly buckets: readonly PointAggregateBucket[];
  /** True timestamps of the previous period; `null`/absent when there is none. */
  readonly compareBuckets?: readonly PointAggregateBucket[] | null;
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
 */
export function buildHistoryChartOption(args: {
  readonly from: number;
  readonly to: number;
  readonly series: readonly HistorySeriesInput[];
  readonly compare: { readonly spanMs: number } | null;
  readonly roles: Roles;
}): EChartsOption {
  const { from, to, series, compare, roles } = args;
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

  return {
    color: palette,
    tooltip: { trigger: "axis" },
    xAxis: { type: "time", min: from, max: to },
    yAxis: (units.length > 0 ? units : [null]).map((unit) => ({
      type: "value" as const,
      ...(unit ? { name: unit } : {}),
    })),
    series: lines,
  };
}
