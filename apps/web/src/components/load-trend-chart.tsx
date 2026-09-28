import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { LoadTrendPoint } from "@bms/shared";

type LoadTrendChartProps = {
  points: LoadTrendPoint[];
  status: "loading" | "error" | "empty" | "ready";
  stale?: boolean;
};

export function LoadTrendChart({ points, status, stale }: LoadTrendChartProps) {
  const option = useMemo<EChartsOption>(() => {
    const data = points.map((p) => [p.t, p.totalKw] as [string, number]);
    return {
      color: ["#00A651"],
      grid: { left: 52, right: 20, top: 28, bottom: 36 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => `${Number(v).toFixed(1)} kW`,
      },
      xAxis: {
        type: "time",
        axisLabel: { color: "#4A5464", fontSize: 10 },
        axisLine: { lineStyle: { color: "#D8DCE3" } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: "#7A8494", fontSize: 10 },
        axisLabel: { color: "#4A5464", fontSize: 10 },
        splitLine: { lineStyle: { color: "#EAECF0" } },
      },
      series: [
        {
          type: "line",
          showSymbol: false,
          smooth: true,
          areaStyle: {
            color: "rgba(0, 166, 81, 0.12)",
          },
          lineStyle: { width: 2 },
          data,
        },
      ],
    };
  }, [points]);

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
        style={{ height: 280 }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
