import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { LoadTrendPoint } from "@bms/shared";

import { useChartTheme } from "../lib/chart-theme";
import { withAlpha } from "../lib/theme";

type LoadTrendChartProps = {
  points: LoadTrendPoint[];
  status: "loading" | "error" | "empty" | "ready";
  stale?: boolean;
};

/**
 * `F3.65c` — the line and its area are `accent` from the current roles; axis, label and tooltip
 * colours come from the ECharts theme object (`lib/chart-theme.ts`), so a theme toggle repaints
 * both (plan D2).
 */
export function LoadTrendChart({ points, status, stale }: LoadTrendChartProps) {
  const { roles, theme } = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const data = points.map((p) => [p.t, p.totalKw] as [string, number]);
    return {
      color: [roles.accent],
      grid: { left: 52, right: 20, top: 28, bottom: 36 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `${Number(v).toFixed(1)} kW`,
      },
      xAxis: {
        type: "time",
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: "line",
          showSymbol: false,
          smooth: true,
          areaStyle: {
            color: withAlpha(roles.accent, 0.12),
          },
          lineStyle: { width: 2 },
          data,
        },
      ],
    };
  }, [points, roles]);

  if (status === "loading") {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-line bg-surface text-sm text-ink-muted">
        Loading trend…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-critical-wash-strong bg-critical-wash/50 text-sm text-critical-ink">
        Could not load trend data.
      </div>
    );
  }
  if (status === "empty" || points.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-line bg-surface text-sm text-ink-muted">
        No kW history yet — start the simulator.
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border bg-surface p-2 shadow-sm ${stale ? "ring-2 ring-warning/60" : "border-line"}`}
    >
      <ReactECharts
        option={option}
        theme={theme}
        style={{ height: 280 }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
