import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { PointForecastResponse } from "@bms/shared";

import { buildHistoryChartOption } from "../../lib/asset-history-chart-option";
import { useChartTheme } from "../../lib/chart-theme";
import type { HourlyMean } from "../../lib/forecast-hourly";
import { forecastIsLive } from "../../lib/forecast-series";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { ACCESS_SENTENCE, timeAxisLabel } from "../asset-history/history-format";
import { ForecastCaption } from "../forecast-caption";
import { WidgetFrame } from "./widget-frame";

export const NO_FORECAST_POINT_SENTENCE = "No point bound.";
export const NO_FORECAST_YET_SENTENCE = "No forecast for this point yet.";
/** The static draw (no live binding): the widget reads only on a live dashboard. */
export const FORECAST_STATIC_SENTENCE = "The last 24 h and the next 48 h draw on the live dashboard.";
/** The builder inspector's one line for a forecast widget, in place of unit and decimals. */
export const FORECAST_INSPECTOR_NOTE = "Advisory. The last 24 h and the next 48 h for one point.";

/** What the live wrapper read for the widget's one point. */
export type ForecastWidgetRead = {
  /** The actual window's ends (epoch ms), from the aggregate answer. */
  readonly from: number;
  readonly to: number;
  /** The window's hourly means (`hourlyMeans`, plan R10). */
  readonly actual: readonly HourlyMean[];
  /** The forecast answer; `null` while it loads or once it failed — then nothing forecast is drawn. */
  readonly forecast: PointForecastResponse | null;
  /** The site zone the axis and the caption format times in. */
  readonly zone: string;
};

type ForecastWidgetProps = {
  title: string;
  status: WidgetStatus;
  /** The bound point's key; `null` when the widget binds none. */
  pointKey: string | null;
  unit: string | null;
  /** The aggregate read answered 403 (both routes gate on `canReadAsset`): the access sentence, and nothing else. */
  forbidden?: boolean;
  /** `null` is the static draw, for the dispatcher that reads nothing. */
  read: ForecastWidgetRead | null;
};

/**
 * `E1.4c` / ADR 0135 Amendment 3 C1 — the `forecast` widget, presentational: one point's hourly
 * actual line over the last 24 h, then its p10–p90 band and dashed p50 (`forecast-series.ts`, via
 * the history chart's option builder), a "now" mark at the server's `asOf`, and the advisory
 * caption (`ForecastCaption`). Inside `WidgetFrame`, like every other widget.
 *
 * Three states of its own: no point bound; a point with no current forecast (the actual line
 * still draws, with one sentence under it); and a 403, which says only the access sentence.
 */
export function ForecastWidget({ title, status, pointKey, unit, forbidden = false, read }: ForecastWidgetProps) {
  const { roles, theme } = useChartTheme();
  const asOfMs = read?.forecast ? Date.parse(read.forecast.asOf) : null;

  const option = useMemo<EChartsOption | null>(() => {
    if (read === null || pointKey === null) {
      return null;
    }
    const base = buildHistoryChartOption({
      from: read.from,
      to: read.to,
      series: [{ name: pointKey, unit, buckets: read.actual, forecast: read.forecast?.forecast?.buckets ?? null }],
      compare: null,
      roles,
      asOf: asOfMs,
    });
    const built = base.xAxis as { readonly max?: number } | undefined;
    return {
      ...base,
      grid: { left: 40, right: 16, top: 32, bottom: 24 },
      xAxis: { type: "time", min: read.from, max: built?.max ?? read.to, axisLabel: timeAxisLabel(read.zone) },
    };
  }, [read, pointKey, unit, roles, asOfMs]);

  if (pointKey === null || forbidden || read === null) {
    const sentence = pointKey === null ? NO_FORECAST_POINT_SENTENCE : forbidden ? ACCESS_SENTENCE : FORECAST_STATIC_SENTENCE;
    return (
      <WidgetFrame title={title} status={pointKey === null || forbidden ? "ready" : status}>
        <p className="text-xs text-ink-muted">{sentence}</p>
      </WidgetFrame>
    );
  }

  const answer = read.forecast;
  // The caption names what is drawn: the band draws only while the window is live by `asOf` (N11).
  const drawn = answer?.forecast && (answer.forecast.buckets?.length ?? 0) > 0 && forecastIsLive(read.to, asOfMs);
  return (
    <WidgetFrame title={title} status={status}>
      <div className="relative min-h-0 flex-[1_1_180px]">
        {option === null ? null : (
          <ReactECharts option={option} theme={theme} style={{ position: "absolute", inset: 0, height: "100%" }} notMerge />
        )}
      </div>
      {drawn && answer?.forecast ? <ForecastCaption forecast={answer.forecast} asOf={answer.asOf} zone={read.zone} /> : null}
      {answer !== null && answer.forecast === null ? (
        <p className="mt-1 text-xs text-ink-muted" data-testid="forecast-widget-none">
          {NO_FORECAST_YET_SENTENCE}
        </p>
      ) : null}
    </WidgetFrame>
  );
}
