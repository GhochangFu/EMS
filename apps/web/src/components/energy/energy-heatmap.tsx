import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergyHeatmapCell } from "@bms/shared";

import { useChartTheme } from "../../lib/chart-theme";
import { colourMax, heatmapGrid } from "../../lib/energy-organization-views";
import { withAlpha, type Roles } from "../../lib/theme";
import type { EnergySectionStatus } from "./energy-stack-chart";

type Props = {
  cells: readonly EnergyHeatmapCell[];
  status: EnergySectionStatus;
};

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * The heatmap option: local days across, local hours down, one hue (`accent`)
 * from 8 % alpha at 0 to full at the nearest-rank P95 (cells above saturate).
 * A missing cell is not drawn.
 */
function heatmapOption(cells: readonly EnergyHeatmapCell[], roles: Roles): EChartsOption {
  const grid = heatmapGrid(cells);
  const dayIndex = new Map(grid.days.map((day, i) => [day, i]));
  return {
    grid: { left: 52, right: 20, top: 16, bottom: 72 },
    tooltip: {
      position: "top",
      formatter: (params) => {
        const value = (params as { value?: [number, number, number] }).value;
        if (!value) return "";
        return `${grid.days[value[0]]} ${hourLabel(value[1])} · ${value[2].toFixed(1)} kWh`;
      },
    },
    xAxis: { type: "category", data: grid.days, splitArea: { show: false }, axisLabel: { fontSize: 10 } },
    yAxis: { type: "category", data: grid.hours.map(hourLabel), axisLabel: { fontSize: 10 } },
    visualMap: {
      type: "continuous",
      min: 0,
      max: colourMax(cells),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      text: ["kWh", ""],
      inRange: { color: [withAlpha(roles.accent, 0.08), roles.accent] },
    },
    series: [
      {
        name: "kWh",
        type: "heatmap",
        data: cells.map((c) => [dayIndex.get(c.day) as number, c.hour, c.kwh]),
      },
    ],
  };
}

/**
 * `F4.299` U6 (ADR 0108 Amendment 1, 7.6) — kWh by local day and local hour in
 * the view's zone; the server has already grouped the cells there, so nothing
 * here reads the browser's zone.
 */
export function EnergyHeatmap({ cells, status }: Props) {
  const { roles, theme } = useChartTheme();
  const option = useMemo(() => heatmapOption(cells, roles), [cells, roles]);

  if (status === "loading") {
    return <p className="px-1 py-4 text-sm text-ink-muted">Loading the heatmap…</p>;
  }
  if (status === "error") {
    return <p className="px-1 py-4 text-sm text-critical-ink">Could not load the heatmap.</p>;
  }
  if (status === "empty" || cells.length === 0) {
    return <p className="px-1 py-4 text-sm text-ink-muted">No kW data in this period.</p>;
  }

  const days = new Set(cells.map((c) => c.day)).size;
  return (
    <div className="space-y-1">
      <ReactECharts option={option} theme={theme} style={{ height: 420 }} notMerge lazyUpdate />
      {cells.length < days * 24 ? <p className="text-xs text-ink-muted">Blank cells: no data</p> : null}
    </div>
  );
}
