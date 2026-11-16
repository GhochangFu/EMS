import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { ANOMALY_WIDGET_HOURS } from "@bms/shared";
import type { DashboardWidgetDto } from "@bms/shared";

import { fetchAssetAnomalies } from "../../api/ml";
import { forecastRefetchMs } from "../../hooks/use-point-forecasts";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { FALLBACK_ZONE, isForbidden, retryUnlessForbidden } from "../asset-history/history-format";
import { AnomalyWidget, type AnomalyWidgetRead } from "../widgets/anomaly-widget";

const HOUR_MS = 3_600_000;

/**
 * The widget's window: the last {@link ANOMALY_WIDGET_HOURS} whole UTC hours, ending at the next
 * hour boundary (so the axis reaches "now"). Whole hours, so the 15-minute re-polls of one hour
 * share one query key and the window moves when the hour turns.
 */
export function anomalyWidgetWindow(nowMs: number): { from: number; to: number } {
  const to = Math.ceil(nowMs / HOUR_MS) * HOUR_MS;
  return { from: to - ANOMALY_WIDGET_HOURS * HOUR_MS, to };
}

type AnomalyWidgetLiveProps = {
  widget: Extract<DashboardWidgetDto, { widgetType: "anomaly" }>;
  /** The clock, for tests; `Date.now()` otherwise. */
  now?: number;
};

/**
 * `E1.2d` / ADR 0135 Amendment 5 ruling 4(c) — one `anomaly` widget's live binding. The bound
 * point names the asset (R16); the widget reads `GET /ml/assets/:assetId/anomalies` for the last
 * 168 hours, refetched every 15 minutes (the forecast's pace; the scorer writes hourly). A 403
 * stops the re-poll and the focus refetch and draws the access sentence. The axis and its tooltip are
 * in UTC, and the caption says so: the read names no site zone, and the scores are UTC hours.
 */
export function AnomalyWidgetLive({ widget, now }: AnomalyWidgetLiveProps) {
  const title = widgetTitle(widget.title, widget.widgetType);
  const point = widget.points.find((p) => p.role === "primary") ?? widget.points[0] ?? null;
  const assetId = point?.assetId ?? "";
  const span = anomalyWidgetWindow(now ?? Date.now());
  const from = new Date(span.from).toISOString();
  const to = new Date(span.to).toISOString();

  const result = useQuery({
    queryKey: ["anomaly-widget", assetId, from, to],
    queryFn: () => fetchAssetAnomalies(assetId, from, to),
    enabled: point !== null,
    refetchInterval: (query: { state: { error: unknown } }) => forecastRefetchMs(query.state.error),
    refetchOnWindowFocus: (query: { state: { error: unknown } }) => !isForbidden(query.state.error),
    retry: retryUnlessForbidden,
    // The key moves when the hour turns; without this the widget would show "Loading…" (or an
    // error) for the length of that fetch once an hour. The last window's scores are a subset of
    // the new one, and the line filters to [from, to) (the `use-prior-point-values.ts` precedent).
    placeholderData: keepPreviousData,
  });

  const scores = result.data?.scores ?? null;
  const read = useMemo<AnomalyWidgetRead>(
    () => ({ from: span.from, to: span.to, scores, zone: FALLBACK_ZONE }),
    [span.from, span.to, scores],
  );

  const forbidden = isForbidden(result.error);
  const status: WidgetStatus = result.data !== undefined ? "ready" : result.isError ? "error" : "loading";
  return (
    <AnomalyWidget title={title} status={status} pointKey={point?.pointKey ?? null} forbidden={forbidden} read={read} />
  );
}
