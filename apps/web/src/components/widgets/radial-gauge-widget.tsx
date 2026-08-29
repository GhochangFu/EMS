import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { RadialGaugeConfig, WidgetStatus } from "../../lib/widget-catalog";
import { buildRadialGaugeOption } from "../../lib/widget-echarts-option";
import { WidgetFrame } from "./widget-frame";

type RadialGaugeWidgetProps = {
  title: string;
  status: WidgetStatus;
  primary: number | null;
  stale?: boolean;
  config: RadialGaugeConfig;
};

/**
 * `radial_gauge` on ECharts' native `gauge` series — `load-trend-chart.tsx`'s
 * shape (`ReactECharts`, `notMerge`, `lazyUpdate`). No option construction
 * happens here: every key comes from `buildRadialGaugeOption`.
 *
 * A `null` `primary` while `status === "ready"` (a live binding at zero
 * points, ADR 0047 Amendment 1) pins the needle at `config.min` rather than
 * feeding ECharts a `NaN` — the empty state proper is `WidgetData.status ===
 * "empty"`, which `WidgetFrame` renders instead of this branch.
 */
export function RadialGaugeWidget({ title, status, primary, stale, config }: RadialGaugeWidgetProps) {
  const option = useMemo<EChartsOption>(
    () => buildRadialGaugeOption(config, primary ?? config.min),
    [config, primary],
  );

  return (
    <WidgetFrame title={title} status={status} stale={stale}>
      <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />
    </WidgetFrame>
  );
}
