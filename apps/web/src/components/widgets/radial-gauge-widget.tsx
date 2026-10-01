import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import { useChartTheme } from "../../lib/chart-theme";
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
 *
 * `F3.65c` — the band stops and the theme object both come from the current roles, so a theme
 * toggle re-inits the gauge with the new palette (plan D1/D2).
 */
export function RadialGaugeWidget({ title, status, primary, stale, config }: RadialGaugeWidgetProps) {
  const { roles, theme } = useChartTheme();
  const option = useMemo<EChartsOption>(
    () => buildRadialGaugeOption(config, primary ?? config.min, roles),
    [config, primary, roles],
  );

  return (
    <WidgetFrame title={title} status={status} stale={stale}>
      {/* `F3.73` polish — a 220 px basis that shrinks to the tile (see `ChartWidget`). */}
      <div className="relative min-h-0 flex-[1_1_220px]">
        <ReactECharts
          option={option}
          theme={theme}
          style={{ position: "absolute", inset: 0, height: "100%" }}
          notMerge
          lazyUpdate
        />
      </div>
    </WidgetFrame>
  );
}
