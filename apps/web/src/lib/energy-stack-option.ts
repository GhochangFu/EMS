import type { EChartsOption } from "echarts";

import type { PointAggregateBucket } from "@bms/shared";

import { shiftCompareBuckets } from "./asset-history-range";
import { seriesPalette } from "./chart-theme";
import type { Roles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

/** Every stacked series carries this id, so ECharts piles them by data index. */
export const STACK_ID = "total";

/** One stacked series. `colour: null` takes the next colour of the theme's palette. */
export type EnergyStack = {
  name: string;
  colour: string | null;
  data: [string, number][];
};

/**
 * `F4.299` U5 — the Energy page's stacked total-trend option (by site or by source).
 * Pure: the compare total's buckets keep their true timestamps and move forward by
 * `spanMs`, so the dashed line overlays the current period (ADR 0108 decision 1.3).
 * The series type comes from `CHART_SERIES`, never a literal.
 */
export function buildEnergyStackOption(args: {
  readonly stacks: readonly EnergyStack[];
  readonly compareTotal: readonly PointAggregateBucket[] | null;
  readonly spanMs: number;
  readonly roles: Roles;
}): EChartsOption {
  const { stacks, compareTotal, spanMs, roles } = args;
  const palette = seriesPalette(roles);
  const seriesType = CHART_SERIES.line.type;

  const stacked = stacks.map((stack, i) => {
    const colour = stack.colour ?? palette[i % palette.length];
    return {
      name: stack.name,
      type: seriesType,
      stack: STACK_ID,
      areaStyle: {},
      showSymbol: false,
      smooth: true,
      itemStyle: { color: colour },
      lineStyle: { width: 0 },
      data: stack.data,
    };
  });

  const compare =
    compareTotal === null
      ? []
      : [
          {
            name: "Previous period",
            type: seriesType,
            showSymbol: false,
            itemStyle: { color: roles.ink },
            lineStyle: { color: roles.ink, type: "dashed" as const, width: 1.5 },
            data: shiftCompareBuckets(compareTotal, spanMs).map((b) => [b.t, b.v] as [string, number | null]),
          },
        ];

  return {
    color: stacks.map((stack, i) => stack.colour ?? palette[i % palette.length]),
    legend: { bottom: 0, textStyle: { fontSize: 11 } },
    grid: { left: 52, right: 20, top: 28, bottom: 56 },
    tooltip: { trigger: "axis", valueFormatter: (v) => `${Number(v).toFixed(1)} kW` },
    xAxis: { type: "time", axisLabel: { fontSize: 10 } },
    yAxis: { type: "value", name: "kW", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
    series: [...stacked, ...compare],
  };
}
