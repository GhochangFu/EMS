import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { HealthSummaryResponse } from "@bms/shared";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthDonutSlices,
} from "../../lib/asset-health-view";
import { formatBucketWidth } from "../../lib/widget-value";

type HealthSummaryDonutProps = {
  title?: string;
  summary: HealthSummaryResponse;
};

/** Excellent → Critical, the client's own five names (ADR 0050 Context). A
 * summary whose template names a different band vocabulary still gets a
 * colour, cycling rather than running out. */
const SLICE_COLORS = ["#16a34a", "#65a30d", "#eab308", "#f97316", "#dc2626"];

/**
 * `E1.3` Unit 8 — the plant/enterprise donut (ADR 0050 Amendment 1 decision
 * 5). Renders `bandCounts` as the pie, and the two tail counts
 * (`unbandedAssetCount`, `unscoredAssetCount`) as their OWN legend rows — see
 * `asset-health-view.ts`'s `healthDonutSlices` docblock for why they must
 * never be folded into one "other" slice.
 *
 * `bucketSeconds`/`computedAt` sit in the same footer language
 * `chart-widget.tsx`'s `ChartFooter` already uses, so a person reading this
 * donut beside a live chart sees the same "what is this current to" idiom
 * rather than a second one invented here (ADR 0050 Amendment 1 decision 9).
 */
export function HealthSummaryDonut({ title = "Asset Health", summary }: HealthSummaryDonutProps) {
  // Memoised on the two primitives, not on `healthDonutSlices`'s return value
  // — a fresh array identity every render would make the `option` memo below
  // never hit, the same defect `chart-widget.tsx`'s docblock names and
  // justifies there (it reads a live clock). Nothing here has that excuse.
  const slices = useMemo(
    () => healthDonutSlices(summary.bandCounts, summary.assetCount),
    [summary.bandCounts, summary.assetCount],
  );

  const option = useMemo<EChartsOption>(
    () => ({
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["55%", "80%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: slices.map((slice, i) => ({
            name: slice.label,
            value: slice.count,
            itemStyle: { color: SLICE_COLORS[i % SLICE_COLORS.length] },
          })),
        },
      ],
    }),
    [slices],
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-bms-muted">{title}</h3>
      <ReactECharts option={option} style={{ height: 200 }} notMerge lazyUpdate />
      <dl className="mt-2 grid grid-cols-1 gap-y-1 text-xs text-bms-ink">
        {slices.map((slice) => (
          <div key={slice.code} className="flex items-center justify-between gap-2">
            <dt>{slice.label}</dt>
            <dd className="tabular-nums">
              {slice.count} · {slice.percent === null ? "—" : `${slice.percent.toFixed(1)}%`}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-bms-muted">
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Scored</dt>
          <dd className="tabular-nums text-bms-ink">
            {summary.scoredAssetCount} / {summary.assetCount}
          </dd>
        </div>
        {/* Two SEPARATE rows, never one sum — unbanded assets HAVE a score,
            unscored assets do not (ADR 0050 Amendment 1 decisions 3 and 7). */}
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Unbanded</dt>
          <dd className="tabular-nums text-bms-ink">{summary.unbandedAssetCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Unscored</dt>
          <dd className="tabular-nums text-bms-ink">{summary.unscoredAssetCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Mean score</dt>
          <dd className="tabular-nums text-bms-ink">{formatHealthScorePercent(summary.score)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Granularity</dt>
          <dd className="text-bms-ink">{formatBucketWidth(summary.bucketSeconds)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Current to</dt>
          <dd className="text-bms-ink">{formatHealthComputedAt(summary.computedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}
