import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { EnergyHeatmapCell } from "@bms/shared";

import { useChartTheme } from "../../lib/chart-theme";
import { colourMax, heatmapGrid } from "../../lib/energy-organization-views";
import { heatmapEmptyCells, heatmapEmptySeries, heatmapTileStyle, heatmapVisualMaps } from "../../lib/heatmap-style";
import { type Roles } from "../../lib/theme";
import type { EnergySectionStatus } from "./energy-stack-chart";
import { chartType } from "../../lib/design";

type Props = {
  cells: readonly EnergyHeatmapCell[];
  status: EnergySectionStatus;
};

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * The heatmap option: local days across, local hours down, one hue (`series-1`) in five stepped
 * bands from 0 to the nearest-rank P95 (cells above land in the top band), on gapped tiles. An hour
 * with no reading is a plain `well` tile (`lib/heatmap-style.ts`).
 */
function heatmapOption(cells: readonly EnergyHeatmapCell[], roles: Roles): EChartsOption {
  const grid = heatmapGrid(cells);
  const dayIndex = new Map(grid.days.map((day, i) => [day, i]));
  const filled = cells.map((c) => [dayIndex.get(c.day) as number, c.hour, c.kwh] as [number, number, number]);
  return {
    grid: { left: 52, right: 20, top: 16, bottom: 56 },
    tooltip: {
      position: "top",
      formatter: (params) => {
        const value = (params as { value?: [number, number, number] }).value;
        if (!value) return "";
        return `${grid.days[value[0]]} ${hourLabel(value[1])} · ${value[2].toFixed(1)} kWh`;
      },
    },
    xAxis: { type: "category", data: grid.days, splitArea: { show: false }, axisLabel: { fontSize: chartType()["3xs"] } },
    yAxis: { type: "category", data: grid.hours.map(hourLabel), axisLabel: { fontSize: chartType()["3xs"] } },
    visualMap: heatmapVisualMaps(0, colourMax(cells), roles["series-1"], roles, (v) => `${v.toFixed(1)} kWh`),
    series: [
      { name: "kWh", type: "heatmap", data: filled, itemStyle: heatmapTileStyle(roles) },
      heatmapEmptySeries(heatmapEmptyCells(grid.days.length, grid.hours.length, filled), roles),
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
