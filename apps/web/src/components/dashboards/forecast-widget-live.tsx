import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { encodePointRef, FORECAST_WIDGET_ACTUAL_HOURS } from "@bms/shared";
import type { DashboardWidgetDto } from "@bms/shared";

import { fetchPointAggregate } from "../../api/telemetry";
import { usePointForecasts } from "../../hooks/use-point-forecasts";
import { hourlyMeans } from "../../lib/forecast-hourly";
import { FORECAST_REFETCH_MS } from "../../lib/forecast-series";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { isForbidden, retryUnlessForbidden, siteZoneOf } from "../asset-history/history-format";
import { ForecastWidget, type ForecastWidgetRead } from "../widgets/forecast-widget";

/** The actual window: the history page's 24 h preset, in minutes (1,440). */
export const FORECAST_WIDGET_WINDOW_MINUTES = FORECAST_WIDGET_ACTUAL_HOURS * 60;

type ForecastWidgetLiveProps = {
  widget: Extract<DashboardWidgetDto, { widgetType: "forecast" }>;
};

/**
 * `E1.4c` / ADR 0135 Amendment 3 C1 (plan R10) — one `forecast` widget's live binding. It reads
 * its primary point twice: the aggregate route for the last 1,440 minutes with
 * `bucketFunction=avg&bucketStats=true` (the history page's 24 h read), averaged to whole UTC hours
 * in the browser, and the point's current forecast. Both refetch every 15 minutes, the scorer's
 * pace; a 403 stops both (`retryUnlessForbidden`, `forecastRefetchMs`) and draws the access
 * sentence. A failed forecast read is "no forecast drawn", never a widget error.
 */
export function ForecastWidgetLive({ widget }: ForecastWidgetLiveProps) {
  const title = widgetTitle(widget.title, widget.widgetType);
  const point = widget.points.find((p) => p.role === "primary") ?? widget.points[0] ?? null;
  const ref = point === null ? "" : encodePointRef(point.assetId, point.pointKey);

  const aggregate = useQuery({
    queryKey: ["forecast-widget-actual", ref, FORECAST_WIDGET_WINDOW_MINUTES],
    queryFn: () =>
      fetchPointAggregate(ref, {
        windowMinutes: FORECAST_WIDGET_WINDOW_MINUTES,
        bucketFunction: "avg",
        bucketStats: true,
      }),
    enabled: point !== null,
    refetchInterval: (query: { state: { error: unknown } }) => (isForbidden(query.state.error) ? false : FORECAST_REFETCH_MS),
    retry: retryUnlessForbidden,
  });
  const [forecastRead] = usePointForecasts(point?.assetId ?? "", point === null ? [] : [point.pointKey], point !== null);

  const data = aggregate.data;
  const forecast = forecastRead?.data ?? null;
  const read = useMemo<ForecastWidgetRead | null>(
    () =>
      data === undefined
        ? null
        : {
            from: Date.parse(data.from),
            to: Date.parse(data.to),
            actual: hourlyMeans(data.buckets ?? []),
            forecast,
            zone: siteZoneOf(data.timeZone).zone,
          },
    [data, forecast],
  );

  const forbidden = isForbidden(aggregate.error);
  const status: WidgetStatus = data !== undefined ? "ready" : aggregate.isError ? "error" : "loading";
  return (
    <ForecastWidget
      title={title}
      status={status}
      pointKey={point?.pointKey ?? null}
      unit={point?.unit ?? null}
      forbidden={forbidden}
      read={read === null ? FORECAST_PENDING : read}
    />
  );
}

/** Before the aggregate answers: an empty read, so the frame's loading or error state draws. */
const FORECAST_PENDING: ForecastWidgetRead = { from: 0, to: 0, actual: [], forecast: null, zone: "Etc/UTC" };
