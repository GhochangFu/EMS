import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { PointAggregateStats } from "@bms/shared";

import type { ChartConfig, WidgetSeries, WidgetStatus } from "../../lib/widget-catalog";
import { buildChartOption } from "../../lib/widget-echarts-option";
import { formatBucketWidth, formatWidgetValue } from "../../lib/widget-value";
import { WidgetFrame } from "./widget-frame";

type ChartWidgetProps = {
  title: string;
  status: WidgetStatus;
  series: readonly WidgetSeries[];
  stale?: boolean;
  config: ChartConfig;
  now: number;
  /** `F3.35` — the scalar half of the same response the buckets came from. */
  stats?: PointAggregateStats | null;
  /** `F3.35` — the chosen level's bucket width, which the granularity cell names. */
  bucketSeconds?: number | null;
};

/**
 * `chart` — the generic type (ADR 0047 decision 4): one component, four
 * ECharts series shapes chosen by `config.series`. `load-trend-chart.tsx`'s
 * shape. No option construction happens here: every key comes from
 * `buildChartOption`, which reads the series type from `CHART_SERIES` rather
 * than from a literal in this file.
 *
 * **Known, recorded rather than fixed here: `useMemo` below can never
 * return a cached value.** `DashboardWidget` passes `now ?? Date.now()`,
 * read fresh on every render, so `[config, series, now]` never matches its
 * previous dependency list and `echarts-for-react`'s deep compare then calls
 * `setOption(..., { notMerge: true })` — a full replace at the parent's
 * render rate. Unlike `load-trend-chart.tsx:48`, which memoises on
 * `[points]` alone and reads no clock, this component's whole reason to take
 * `now` is `windowMinutes`' rolling window. Freezing `now` stops the window
 * rolling; bucketing samples into a coarser granularity invents a cadence
 * this row has no basis to choose. That decision belongs to `F3.1d`, which
 * owns the window/refresh cadence the builder surface configures — do not
 * pick a fix here.
 */
export function ChartWidget({
  title,
  status,
  series,
  stale,
  config,
  now,
  stats,
  bucketSeconds,
}: ChartWidgetProps) {
  const option = useMemo<EChartsOption>(() => buildChartOption(config, series, now), [config, series, now]);

  return (
    <WidgetFrame title={title} status={status} stale={stale}>
      <ReactECharts option={option} style={{ height: 220 }} notMerge lazyUpdate />
      {config.footerStats && status === "ready" ? (
        <ChartFooter config={config} stats={stats ?? null} bucketSeconds={bucketSeconds ?? null} />
      ) : null}
    </WidgetFrame>
  );
}

/**
 * The `.c-foot` row from Sheet 01.
 *
 * **Peak and Average are the deck's own two cells. Granularity is not**
 * (compliance review — the earlier wording read as if the deck showed all
 * three). Sheet 01's third cell is domain-specific — *Contract · 78% of
 * demand*, *Recycle · 72%* — and neither is computable from a point rollup:
 * ADR 0048 decision 7 assigns both to Stage C's two client-owed inputs. The
 * granularity cell occupies that slot in the meantime, and earns it below.
 *
 * **It describes the FIRST series.** A multi-series chart has one footer and
 * several plots, so one of them has to be the one described; the first is the
 * one whose colour the legend leads with, and `widgetDataFor` resolves it from
 * the stored `sortOrder` rather than from array position.
 *
 * **The granularity cell is not decoration.** The ladder has a visible cliff — a
 * 2,880-minute window plots minute buckets and a 2,881-minute one plots hourly
 * buckets — and that is deterministic from the author's own configured window
 * rather than the retention kind of silent widening. It still has to be legible
 * on the chart instead of inferred from its shape.
 *
 * Rendered inside `WidgetFrame` rather than through a new `subtitle` prop on it:
 * `WidgetFrame` is shared by three renderers and has no sub-line slot, so adding
 * one would widen a shared component for one caller.
 */
function ChartFooter({
  config,
  stats,
  bucketSeconds,
}: {
  config: ChartConfig;
  stats: PointAggregateStats | null;
  bucketSeconds: number | null;
}) {
  const format = { decimals: config.decimals, unit: config.unit };
  return (
    <dl className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[11px] text-bms-muted">
      <div className="flex items-baseline gap-1">
        <dt className="font-medium uppercase tracking-wide">Peak</dt>
        <dd className="tabular-nums text-bms-ink">
          {formatWidgetValue(stats?.max ?? null, format)}
          {stats?.peakAt ? (
            // A bucket START, not a sample time — the rollup relations keep no
            // sample timestamps. Rendered at the precision the bucket width
            // implies rather than to the second, which would be a claim the
            // data cannot support.
            <span className="ml-1 font-normal text-bms-muted">
              · {peakLabel(stats.peakAt, bucketSeconds)}
            </span>
          ) : null}
        </dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="font-medium uppercase tracking-wide">Average</dt>
        <dd className="tabular-nums text-bms-ink">{formatWidgetValue(stats?.average ?? null, format)}</dd>
      </div>
      <div className="flex items-baseline gap-1">
        <dt className="font-medium uppercase tracking-wide">Granularity</dt>
        <dd className="text-bms-ink">{formatBucketWidth(bucketSeconds)}</dd>
      </div>
    </dl>
  );
}

/**
 * The peak's bucket start, at the precision its width supports.
 *
 * **A time alone is only enough inside a day** (code review). A 30-day window
 * reads at `1h`, so a bare `14:00` says nothing about which of the thirty days
 * the peak fell on — the width implies an hour of a *specific* day. Anything
 * past a day of window therefore carries the date too.
 *
 * An unparseable timestamp renders the em dash the rest of this file already
 * uses, never `"Invalid Date"` — which is what `new Date(x).toLocaleString()`
 * prints and which reads to an operator like a value.
 */
function peakLabel(iso: string, bucketSeconds: number | null): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return "—";
  }
  if (bucketSeconds !== null && bucketSeconds >= 86_400) {
    return at.toLocaleDateString();
  }
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Minute buckets only ever cover 48 hours, so the time alone is unambiguous
  // enough; an hourly bucket can be up to 30 days back and is not.
  return bucketSeconds !== null && bucketSeconds >= 3_600
    ? `${at.toLocaleDateString()} ${time}`
    : time;
}
