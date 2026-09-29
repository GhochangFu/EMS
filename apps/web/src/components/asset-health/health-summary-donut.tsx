import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { HealthSummaryResponse } from "@bms/shared";

import {
  formatHealthComputedAt,
  formatHealthScorePercent,
  healthDonutSlices,
  healthWindowCoverage,
} from "../../lib/asset-health-view";
import { useChartTheme } from "../../lib/chart-theme";
import type { RoleName } from "../../lib/theme";
import { formatBucketWidth } from "../../lib/widget-value";

type HealthSummaryDonutProps = {
  title?: string;
  summary: HealthSummaryResponse;
};

/** Excellent → Critical, the client's own five names (ADR 0050 Context). A
 * summary whose template names a different band vocabulary still gets a
 * colour, cycling rather than running out.
 *
 * `F3.65c` (owner ruling OQ4) — five roles, resolved for the current theme. The Fair slice's
 * `warning-on-dark` is under 3:1 on a light `surface`, a declared light allowlist entry in
 * `tests/f3.65a-colour-contrast.test.ts`: every slice is named in the legend list below. */
const SLICE_ROLES: readonly RoleName[] = ["accent", "accent-strong", "warning-on-dark", "warning", "critical"];

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
 *
 * **An empty `bandCounts` renders a sentence, not an empty canvas** (`F4.74`).
 * A pie with `data: []` draws nothing inside a 200 px box, which is
 * indistinguishable from a chart that failed — and it was read as exactly that
 * on the running stack on 2026-08-31, while the figures below it were correct.
 * The blank is not transient either: Amendment 1 decision 3 gives bands no
 * default, so an asset whose template configures none is scored, counted and
 * **permanently** unbanded. A surface that goes quiet in a steady state has to
 * say which state it is in.
 *
 * **The figures stay.** This replaces the pie only, never the footer — the same
 * rule `health-summary-section.tsx` follows one level up, where an empty scope
 * is its own sentence rather than a reason to drop the component.
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

  // **A different axis from `slices.length`, and deliberately not folded into
  // it** (`F4.72`). "No band cut-points configured" is about the template
  // vocabulary; this is about how much of the requested window the figures rest
  // on. A donut can have every slice and a half-covered window, or no slice and
  // a whole one, so neither sentence may replace the other.
  const coverage = healthWindowCoverage(summary.coveredBuckets, summary.expectedBuckets);

  const { roles, theme } = useChartTheme();
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
            itemStyle: { color: roles[SLICE_ROLES[i % SLICE_ROLES.length]] },
          })),
        },
      ],
    }),
    [slices, roles],
  );

  return (
    <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-3 shadow-sm">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{title}</h3>
      {slices.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-1 px-4 text-center"
          style={{ height: 200 }}
        >
          <p className="text-xs font-medium text-ink">No band cut-points configured</p>
          <p className="text-[11px] leading-snug text-ink-muted">
            Bands come from an asset template&rsquo;s health tier. The figures below are real; only
            the slices are missing.
          </p>
        </div>
      ) : (
        <ReactECharts option={option} theme={theme} style={{ height: 200 }} notMerge lazyUpdate />
      )}
      <dl className="mt-2 grid grid-cols-1 gap-y-1 text-xs text-ink">
        {slices.map((slice) => (
          <div key={slice.code} className="flex items-center justify-between gap-2">
            <dt>{slice.label}</dt>
            <dd className="tabular-nums">
              {slice.count} · {slice.percent === null ? "—" : `${slice.percent.toFixed(1)}%`}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-well-deep pt-2 text-[11px] text-ink-muted">
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Scored</dt>
          <dd className="tabular-nums text-ink">
            {summary.scoredAssetCount} / {summary.assetCount}
          </dd>
        </div>
        {/* Two SEPARATE rows, never one sum — unbanded assets HAVE a score,
            unscored assets do not (ADR 0050 Amendment 1 decisions 3 and 7). */}
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Unbanded</dt>
          <dd className="tabular-nums text-ink">{summary.unbandedAssetCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Unscored</dt>
          <dd className="tabular-nums text-ink">{summary.unscoredAssetCount}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Mean score</dt>
          <dd className="tabular-nums text-ink">{formatHealthScorePercent(summary.score)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Granularity</dt>
          <dd className="text-ink">{formatBucketWidth(summary.bucketSeconds)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Current to</dt>
          <dd className="text-ink">{formatHealthComputedAt(summary.computedAt)}</dd>
        </div>
        <div className="flex items-baseline gap-1">
          <dt className="font-medium uppercase tracking-wide">Coverage</dt>
          <dd className="tabular-nums text-ink">{coverage.detail}</dd>
        </div>
      </dl>

      {coverage.warning !== null ? (
        <p className="mt-2 rounded border border-warning-line bg-warning-wash px-2 py-1 text-[11px] leading-snug text-warning-ink">
          {coverage.warning}
        </p>
      ) : null}
    </div>
  );
}
