import { forecastListResponseSchema, pastForecastResponseSchema, pointForecastResponseSchema } from "@bms/shared/contracts";
import type { ForecastListResponse, PastForecastResponse, PointForecastResponse } from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c — the forecast reads. Both parse through the shared contract
 * (`checkResponse`, never a cast). A 401 clears the session first; a failure throws an
 * `ApiError` named `"<name> <status>"`, the shape `isForbidden` reads
 * (`components/asset-history/history-format.ts`) and the status `shouldRetryQuery` reads.
 */

/** `GET /api/v1/ml/points/:pointRef/forecast` — `pointRefEncoded` is `encodePointRef`'s output. */
export async function fetchPointForecast(pointRefEncoded: string): Promise<PointForecastResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/ml/points/${pointRefEncoded}/forecast`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml forecast ${res.status}`, res.status);
  }
  return checkResponse(pointForecastResponseSchema, await res.json(), "ml/points/:pointRef/forecast");
}

/** `GET /api/v1/ml/forecasts` — one row per forecast point the caller can read. */
export async function fetchForecastList(): Promise<ForecastListResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/ml/forecasts`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml forecasts ${res.status}`, res.status);
  }
  return checkResponse(forecastListResponseSchema, await res.json(), "ml/forecasts");
}

/**
 * `E1.4e` — `GET /api/v1/ml/points/:pointRef/forecast/past?from=&to=`: for each past hour of the
 * window, the forecast made 1 h ahead (ADR 0135 Amendment 4). `from` and `to` are ISO instants,
 * the window the history read was served.
 */
export async function fetchPastForecast(pointRefEncoded: string, from: string, to: string): Promise<PastForecastResponse> {
  const sent = withAuth();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(`${base}/api/v1/ml/points/${pointRefEncoded}/forecast/past?${query}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml past forecast ${res.status}`, res.status);
  }
  return checkResponse(pastForecastResponseSchema, await res.json(), "ml/points/:pointRef/forecast/past");
}

