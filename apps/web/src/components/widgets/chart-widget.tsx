import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { ChartConfig, WidgetSeries, WidgetStatus } from "../../lib/widget-catalog";
import { buildChartOption } from "../../lib/widget-echarts-option";
import { WidgetFrame } from "./widget-frame";

type ChartWidgetProps = {
  title: string;
  status: WidgetStatus;
  series: readonly WidgetSeries[];
  config: ChartConfig;
  now: number;
};

/**
 * `chart` — the generic type (ADR 0047 decision 4): one component, four
 * ECharts series shapes chosen by `config.series`. `load-trend-chart.tsx`'s
 * shape. No option construction happens here: every key comes from
 * `buildChartOption`, which reads the series type from `CHART_SERIES` rather
 * than from a literal in this file.
 *
 * **Known, recorded rather than fixed here: `useMemo` below can never
 * return a cached value.** `DashboardWidget` passes `now ?? Date.now()`,
 * read fresh on every render, so `[config, series, now]` never matches its
 * previous dependency list and `echarts-for-react`'s deep compare then calls
 * `setOption(..., { notMerge: true })` — a full replace at the parent's
 * render rate. Unlike `load-trend-chart.tsx:48`, which memoises on
 * `[points]` alone and reads no clock, this component's whole reason to take
 * `now` is `windowMinutes`' rolling window. Freezing `now` stops the window
 * rolling; bucketing samples into a coarser granularity invents a cadence
 * this row has no basis to choose. That decision belongs to `F3.1d`, which
 * owns the window/refresh cadence the builder surface configures — do not
 * pick a fix here.
 */
export function ChartWidget({ title, status, series, config, now }: ChartWidgetProps) {
  const option = useMemo<EChartsOption>(() => buildChartOption(config, series, now), [config, series, now]);

  return (
    <WidgetFrame title={title} status={status}>
      <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />
    </WidgetFrame>
  );
}
