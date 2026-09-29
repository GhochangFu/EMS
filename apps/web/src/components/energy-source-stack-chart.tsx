import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergySourceMixPoint } from "@bms/shared";

import { useChartTheme } from "../lib/chart-theme";

type Props = {
  points: EnergySourceMixPoint[];
  status: "loading" | "error" | "empty" | "ready";
};

/**
 * `F3.65c` — Grid `ink-faint`, DG `warning`, Solar `accent` from the current roles; the axis,
 * legend and tooltip colours come from the ECharts theme object (plan D2).
 */
export function EnergySourceStackChart({ points, status }: Props) {
  const { roles, theme } = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      color: [roles["ink-faint"], roles.warning, roles.accent],
      legend: {
        data: ["Grid", "DG (nominal)", "Solar"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: 52, right: 20, top: 28, bottom: 56 },
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
  }, [points, roles]);

  if (status === "loading") {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-line bg-surface text-sm text-ink-muted">
        Loading source mix…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-critical-wash-strong bg-critical-wash/50 text-sm text-critical-ink">
        Could not load source mix.
      </div>
    );
  }
  if (status === "empty" || points.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-line bg-surface text-sm text-ink-muted">
        No telemetry in this window — run the simulator.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2 shadow-sm">
      <ReactECharts
        option={option}
        theme={theme}
        style={{ height: 300 }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
