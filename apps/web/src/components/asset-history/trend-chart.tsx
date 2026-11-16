import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { useMemo } from "react";

import type { AnomalyScore, PastForecastBucket, PointAggregateResponse, PointForecast } from "@bms/shared";

import { ANOMALY_CAPTION, unusualHours } from "../../lib/anomaly-series";
import { buildHistoryChartOption } from "../../lib/asset-history-chart-option";
import { useChartTheme } from "../../lib/chart-theme";
import { forecastIsLive, PAST_FORECAST_CAPTION } from "../../lib/forecast-series";
import { formatBucketWidth } from "../../lib/widget-value";
import { ForecastCaption } from "../forecast-caption";
import { SectionCard } from "../section-card";
import { formatInZone, timeAxisLabel, type SiteZone } from "./history-format";

export const NO_PREVIOUS_SENTENCE = "no data for the previous period";

export interface TrendSeries {
  readonly pointKey: string;
  readonly unit: string | null;
  readonly data: PointAggregateResponse;
  /** `E1.4a`: the point's current forecast, or `null`/absent. */
  readonly forecast?: PointForecast | null;
  /** `E1.4e`: the forecast made 1 h ahead of each past hour, or `null`/absent. */
  readonly pastForecast?: readonly PastForecastBucket[] | null;
}

type TrendChartProps = {
  series: readonly TrendSeries[];
  /**
   * How many points are charted. With one or more and no series, the reads are loading or
   * failed (the page shows the error), so the chart does not ask for a point to be chosen.
   */
  chartedCount: number;
  compare: boolean;
  siteZone: SiteZone;
  /** `E1.4a`: the forecast reads' server instant (ISO); `null`/absent draws no forecast. */
  forecastAsOf?: string | null;
  /** `E1.2b`: the asset's anomaly scores over the window; `null`/absent draws no mark. */
  anomalies?: readonly AnomalyScore[] | null;
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
 *
 * `E1.4a` (ADR 0135 Amendment 3 R-d, C2): a series with a forecast draws its band and p50 when the
 * window is live by the server's `forecastAsOf`, and the x axis then ends where the built option
 * says — not at `to`, or the forecast would be clipped off. One caption line per drawn forecast.
 *
 * `E1.4e` (ADR 0135 Amendment 4): a series with a past forecast draws it as a dashed line in its
 * own colour on any window, with one caption line saying what it is, and no accuracy number.
 *
 * `E1.2b` (ADR 0135 Amendment 5 ruling 4(b)): the asset's unusual hours are marked on the chart,
 * advisory, and one caption line says what a mark is — only when at least one mark is drawn.
 */
export function TrendChart({ series, chartedCount, compare, siteZone, forecastAsOf = null, anomalies = null }: TrendChartProps) {
  const { roles, theme } = useChartTheme();
  const first = series[0]?.data;
  const asOfMs = forecastAsOf === null ? null : Date.parse(forecastAsOf);
  const live = first !== undefined && forecastIsLive(Date.parse(first.to), asOfMs);
  // `?.` on `buckets` too: production passes a drifted payload through, and a throw here would take
  // the page down for an advisory overlay.
  const forecasting = live ? series.filter((s) => (s.forecast?.buckets?.length ?? 0) > 0) : [];

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
        forecast: s.forecast?.buckets ?? null,
        pastForecast: s.pastForecast ?? null,
      })),
      compare: compare ? { spanMs: to - from } : null,
      roles,
      asOf: asOfMs,
      anomalies,
    });
    const built = base.xAxis as { readonly max?: number } | undefined;
    return {
      ...base,
      xAxis: {
        type: "time",
        min: from,
        max: built?.max ?? to,
        axisLabel: timeAxisLabel(siteZone.zone),
      },
    };
  }, [first, series, compare, roles, siteZone.zone, asOfMs, anomalies]);
  const marked =
    first !== undefined && unusualHours(anomalies ?? [], Date.parse(first.from), Date.parse(first.to)).length > 0;

  if (first === undefined || option === null) {
    return (
      <SectionCard title="Trend">
        <p className="text-xs text-ink-muted">
          {chartedCount > 0 ? "No chart data to show." : "Choose a point to chart."}
        </p>
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
      {forecastAsOf === null
        ? null
        : forecasting.map((s) =>
            s.forecast ? (
              <ForecastCaption
                key={s.pointKey}
                forecast={s.forecast}
                asOf={forecastAsOf}
                zone={siteZone.zone}
                pointKey={forecasting.length > 1 ? s.pointKey : null}
              />
            ) : null,
          )}
      {series.some((s) => (s.pastForecast?.length ?? 0) > 0) ? (
        <p className="text-xs text-ink-muted" data-testid="past-forecast-caption">
          {PAST_FORECAST_CAPTION}
        </p>
      ) : null}
      {marked ? (
        <p className="text-xs text-ink-muted" data-testid="anomaly-caption">
          {ANOMALY_CAPTION}
        </p>
      ) : null}
      {compare && previousPeriodIsEmpty(series) ? (
        <p className="mt-1 text-xs text-ink-muted" data-testid="history-no-previous">
          {NO_PREVIOUS_SENTENCE}
        </p>
      ) : null}
    </SectionCard>
  );
}
