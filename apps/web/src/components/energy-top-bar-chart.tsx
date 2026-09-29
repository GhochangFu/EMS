import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergyTopConsumer } from "@bms/shared";

import { useChartTheme } from "../lib/chart-theme";

type Props = {
  consumers: EnergyTopConsumer[];
  status: "loading" | "error" | "empty" | "ready";
};

/**
 * `F3.65c` — the bars are `info` from the current roles; the axis, label, tooltip and
 * axis-pointer shadow colours come from the ECharts theme object (plan D2).
 */
export function EnergyTopBarChart({ consumers, status }: Props) {
  const { roles, theme } = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const labels = consumers.map((c) => `${c.code} · ${c.name.slice(0, 18)}`);
    const values = consumers.map((c) => c.estimatedKwh);
    return {
      color: [roles.info],
      grid: { left: 140, right: 28, top: 16, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => `${Number(v).toFixed(0)} kWh (est.)`,
      },
      xAxis: {
        type: "value",
        name: "kWh (est.)",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 22,
        },
      ],
    };
  }, [consumers, roles]);

  if (status === "loading") {
    return (
      <div className="flex h-[320px] items-center justify-center surface-raised text-sm text-ink-muted">
        Loading top consumers…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-critical-wash-strong bg-critical-wash/50 text-sm text-critical-ink">
        Could not load rankings.
      </div>
    );
  }
  if (status === "empty" || consumers.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center surface-raised text-sm text-ink-muted">
        No consumer data in this window.
      </div>
    );
  }

  return (
    <div className="surface-raised p-2">
      <ReactECharts
        option={option}
        theme={theme}
        style={{ height: Math.max(280, consumers.length * 36 + 80) }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
