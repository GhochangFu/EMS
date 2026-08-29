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
 */
export function ChartWidget({ title, status, series, config, now }: ChartWidgetProps) {
  const option = useMemo<EChartsOption>(() => buildChartOption(config, series, now), [config, series, now]);

  return (
    <WidgetFrame title={title} status={status}>
      <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />
    </WidgetFrame>
  );
}
