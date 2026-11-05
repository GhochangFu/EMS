import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { assetLabelOf, type SegmentViewPeriodDto, type SegmentViewRankingEntryDto } from "@bms/shared";

import { seriesPalette, useChartTheme } from "../../lib/chart-theme";
import { compareSpanMs, historyHrefFor, segmentChartSeries } from "../../lib/site-trends";
import { CHART_SERIES } from "../../lib/widget-catalog";

type Props = {
  ranking: readonly SegmentViewRankingEntryDto[];
  current: SegmentViewPeriodDto;
  compare: SegmentViewPeriodDto | null;
  /** The point's catalog unit: the one value axis. */
  unit: string | null;
  pointCode: string;
};

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 4, 7) — the segment's top assets for one point on one
 * unit axis, each asset's previous period dashed in its own colour and moved forward by `+span`
 * (decision 1.3). The legend is a row of links under the chart, so an entry opens the asset's
 * history over the exact window; the ECharts legend is off.
 */
export function SegmentTrendChart({ ranking, current, compare, unit, pointCode }: Props) {
  const { roles, theme } = useChartTheme();
  const drawn = useMemo(() => ranking.filter((entry) => entry.buckets !== null), [ranking]);
  const option = useMemo((): EChartsOption => {
    const palette = seriesPalette(roles);
    const colourOf = new Map(drawn.map((entry, i) => [entry.assetId, palette[i % palette.length]]));
    // With compare off no previous period is drawn, whatever the entries carry.
    const lines = compare === null ? drawn.map((entry) => ({ ...entry, compareBuckets: null })) : drawn;
    const series = segmentChartSeries(lines, compareSpanMs(current, compare)).map((line) => ({
      name: line.dashed ? `${line.label} · previous period` : line.label,
      type: CHART_SERIES.line.type,
      showSymbol: false,
      connectNulls: false,
      itemStyle: { color: colourOf.get(line.assetId) },
      lineStyle: line.dashed ? { type: "dashed" as const, width: 1.5 } : { width: 1.5 },
      data: line.data,
    }));
    return {
      legend: { show: false },
      grid: { left: 52, right: 20, top: 28, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "time", axisLabel: { fontSize: 10 } },
      yAxis: { type: "value", name: unit ?? "", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 10 } },
      series,
    };
  }, [drawn, current, compare, unit, roles]);

  if (drawn.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center surface-raised text-sm text-ink-muted">
        No telemetry for this point in this period.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="surface-raised p-2">
        <ReactECharts option={option} theme={theme} style={{ height: 300 }} notMerge lazyUpdate />
      </div>
      <ul aria-label="Chart legend" className="flex flex-wrap gap-3 text-xs">
        {drawn.map((entry) => (
          <li key={entry.assetId}>
            <Link
              to={historyHrefFor(entry.assetId, current, pointCode, compare !== null)}
              aria-label={`${assetLabelOf(entry)} ${entry.assetName}`}
              title={entry.assetName}
              className="break-words font-semibold text-accent-strong hover:underline"
            >
              {assetLabelOf(entry)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
