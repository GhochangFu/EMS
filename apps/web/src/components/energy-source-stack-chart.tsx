import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergySourceMixPoint } from "@bms/shared";

type Props = {
  points: EnergySourceMixPoint[];
  status: "loading" | "error" | "empty" | "ready";
};

export function EnergySourceStackChart({ points, status }: Props) {
  const option = useMemo<EChartsOption>(() => {
    return {
      color: ["#64748B", "#F59E0B", "#00A651"],
      legend: {
        data: ["Grid", "DG (nominal)", "Solar"],
        bottom: 0,
        textStyle: { fontSize: 11, color: "#4A5464" },
      },
      grid: { left: 52, right: 20, top: 28, bottom: 56 },
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
          name: "Grid",
          type: "line",
          stack: "mix",
          areaStyle: {},
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 0 },
          data: points.map((p) => [p.t, p.gridKw] as [string, number]),
        },
        {
          name: "DG (nominal)",
          type: "line",
          stack: "mix",
          areaStyle: {},
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 0 },
          data: points.map((p) => [p.t, p.dgKw] as [string, number]),
        },
        {
          name: "Solar",
          type: "line",
          stack: "mix",
          areaStyle: {},
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 0 },
          data: points.map((p) => [p.t, p.solarKw] as [string, number]),
        },
      ],
    };
  }, [points]);

  if (status === "loading") {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-gray-200 bg-white text-sm text-bms-muted">
        Loading source mix…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-red-100 bg-red-50/50 text-sm text-red-700">
        Could not load source mix.
      </div>
    );
  }
  if (status === "empty" || points.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-sm text-bms-muted">
        No telemetry in this window — run the simulator.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
      <ReactECharts
        option={option}
        style={{ height: 300 }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
