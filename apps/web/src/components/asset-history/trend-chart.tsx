import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { PointAggregateResponse } from "@bms/shared";

import { buildHistoryChartOption } from "../../lib/asset-history-chart-option";
import { useChartTheme } from "../../lib/chart-theme";
import { formatBucketWidth } from "../../lib/widget-value";
import { SectionCard } from "../section-card";
import { axisLabelInZone, formatInZone, type SiteZone } from "./history-format";

export const NO_PREVIOUS_SENTENCE = "no data for the previous period";

export interface TrendSeries {
  readonly pointKey: string;
  readonly unit: string | null;
  readonly data: PointAggregateResponse;
}

type TrendChartProps = {
  series: readonly TrendSeries[];
  compare: boolean;
  siteZone: SiteZone;
};

/** True when a compare was asked and no series has a single previous-period value. */
export function previousPeriodIsEmpty(series: readonly TrendSeries[]): boolean {
  return series.every((s) => (s.data.compare?.buckets ?? []).every((bucket) => bucket.v === null));
}

/**
 * `F4.297` U5 — the history chart (`buildHistoryChartOption`) and the facts under it: the rollup
 * level the server used (`bucketSeconds`, which reports an escalation too — ADR 0108 decision
 * 1.4), the window ends and the zone they are in (decision 1.9). The x axis labels are formatted
 * in the site zone, never the browser's. A compare whose previous period has no value says so
 * (ruling 4.6) rather than drawing an empty dashed line silently.
 */
export function TrendChart({ series, compare, siteZone }: TrendChartProps) {
  const { roles, theme } = useChartTheme();
  const first = series[0]?.data;

  const option = useMemo<EChartsOption | null>(() => {
    if (first === undefined) {
      return null;
    }
    const from = Date.parse(first.from);
    const to = Date.parse(first.to);
    const base = buildHistoryChartOption({
      from,
      to,
      series: series.map((s) => ({
        name: s.pointKey,
        unit: s.unit,
        buckets: s.data.buckets ?? [],
        compareBuckets: s.data.compare?.buckets ?? null,
      })),
      compare: compare ? { spanMs: to - from } : null,
      roles,
    });
    return {
      ...base,
      xAxis: {
        type: "time",
        min: from,
        max: to,
        axisLabel: { formatter: (value: number) => axisLabelInZone(value, siteZone.zone) },
      },
    };
  }, [first, series, compare, roles, siteZone.zone]);

  if (first === undefined || option === null) {
    return (
      <SectionCard title="Trend">
        <p className="text-xs text-ink-muted">Choose a point to chart.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Trend">
      <div className="relative h-72">
        <ReactECharts option={option} theme={theme} style={{ position: "absolute", inset: 0, height: "100%" }} notMerge />
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <div>
          <dt className="inline">Level: </dt>
          <dd className="inline" data-testid="history-level">
            {formatBucketWidth(first.bucketSeconds)} buckets
          </dd>
        </div>
        <div>
          <dt className="inline">Window: </dt>
          <dd className="inline" data-testid="history-window">
            {formatInZone(first.from, siteZone.zone)} – {formatInZone(first.to, siteZone.zone)}
          </dd>
        </div>
        <div>
          <dt className="inline">Zone: </dt>
          <dd className="inline" data-testid="history-zone">
            {siteZone.label}
            {siteZone.reported ? "" : " (the server named no site zone)"}
          </dd>
        </div>
      </dl>
      {compare && previousPeriodIsEmpty(series) ? (
        <p className="mt-1 text-xs text-ink-muted" data-testid="history-no-previous">
          {NO_PREVIOUS_SENTENCE}
        </p>
      ) : null}
    </SectionCard>
  );
}
