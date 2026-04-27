import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergyTopConsumer } from "@bms/shared";

type Props = {
  consumers: EnergyTopConsumer[];
  status: "loading" | "error" | "empty" | "ready";
};

export function EnergyTopBarChart({ consumers, status }: Props) {
  const option = useMemo<EChartsOption>(() => {
    const labels = consumers.map((c) => `${c.code} · ${c.name.slice(0, 18)}`);
    const values = consumers.map((c) => c.estimatedKwh);
    return {
      color: ["#1570EF"],
      grid: { left: 140, right: 28, top: 16, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => `${Number(v).toFixed(0)} kWh (est.)`,
      },
      xAxis: {
        type: "value",
        name: "kWh (est.)",
        nameTextStyle: { color: "#7A8494", fontSize: 10 },
        axisLabel: { color: "#4A5464", fontSize: 10 },
        splitLine: { lineStyle: { color: "#EAECF0" } },
      },
      yAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: "#4A5464", fontSize: 10 },
        axisLine: { lineStyle: { color: "#D8DCE3" } },
      },
      series: [
        {
          type: "bar",
          data: values,
          barMaxWidth: 22,
        },
      ],
    };
  }, [consumers]);

  if (status === "loading") {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-gray-200 bg-white text-sm text-bms-muted">
        Loading top consumers…
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-red-100 bg-red-50/50 text-sm text-red-700">
        Could not load rankings.
      </div>
    );
  }
  if (status === "empty" || consumers.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-sm text-bms-muted">
        No consumer data in this window.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
      <ReactECharts
        option={option}
        style={{ height: Math.max(280, consumers.length * 36 + 80) }}
        notMerge
        lazyUpdate
      />
    </div>
  );
}
