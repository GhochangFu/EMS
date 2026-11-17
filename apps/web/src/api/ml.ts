import {
  anomalyListResponseSchema,
  assetAnomaliesResponseSchema,
  forecastListResponseSchema,
  mlFindingsParagraphResponseSchema,
  mlFindingsSummaryResponseSchema,
  pastForecastResponseSchema,
  pointForecastResponseSchema,
} from "@bms/shared/contracts";
import type {
  MlFindingsKind,
  MlFindingsParagraphResponse,
  MlFindingsSummaryResponse,
} from "@bms/shared/contracts";
import type {
  AnomalyListResponse,
  AssetAnomaliesResponse,
  ForecastListResponse,
  PastForecastResponse,
  PointForecastResponse,
} from "@bms/shared";

import { ApiError } from "../lib/api-error";
import { ML_PAGE_FILTER_KEYS } from "../lib/ml-findings";
import { SCOPE_FILTER_KEYS, type ScopeFilter } from "../lib/scope-filter";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** The query of `filter`'s `keys` that are set, in `keys` order; empty when none is. */
function scopeParams(filter: ScopeFilter | undefined, keys: readonly (keyof ScopeFilter)[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of keys) {
    const value = filter?.[key];
    if (value) {
      params.set(key, value);
    }
  }
  return params;
}

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

/**
 * `GET /api/v1/ml/forecasts[?organizationId=&locationId=]` — one row per forecast point the caller
 * can read. Only the two list keys are sent (`E1.9b`); with none set the URL is the bare path.
 */
export async function fetchForecastList(filter?: ScopeFilter): Promise<ForecastListResponse> {
  const sent = withAuth();
  const query = scopeParams(filter, ML_PAGE_FILTER_KEYS).toString();
  const res = await fetch(`${base}/api/v1/ml/forecasts${query ? `?${query}` : ""}`, sent);
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

/**
 * `E1.2b` / ADR 0135 Amendment 5 — `GET /api/v1/ml/assets/:assetId/anomalies?from=&to=`: every
 * detector score of one asset's hours in the window (at most 31 days), advisory. The chart applies
 * the 0.99 line (`lib/anomaly-series.ts`).
 */
export async function fetchAssetAnomalies(assetId: string, from: string, to: string): Promise<AssetAnomaliesResponse> {
  const sent = withAuth();
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(`${base}/api/v1/ml/assets/${encodeURIComponent(assetId)}/anomalies?${query}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml asset anomalies ${res.status}`, res.status);
  }
  return checkResponse(assetAnomaliesResponseSchema, await res.json(), "ml/assets/:assetId/anomalies");
}

/**
 * `E1.2b` — `GET /api/v1/ml/anomalies[?organizationId=&locationId=&since=]`: the unusual hours of
 * every asset the caller can read, newest first, at most the last 7 days (the server clamps
 * `since`). For the Anomalies list. Only the two list keys are sent (`E1.9b`).
 */
export async function fetchAnomalyList(filter?: ScopeFilter, since?: string): Promise<AnomalyListResponse> {
  const sent = withAuth();
  const params = scopeParams(filter, ML_PAGE_FILTER_KEYS);
  if (since !== undefined) {
    params.set("since", since);
  }
  const query = params.toString();
  const res = await fetch(`${base}/api/v1/ml/anomalies${query ? `?${query}` : ""}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml anomalies ${res.status}`, res.status);
  }
  return checkResponse(anomalyListResponseSchema, await res.json(), "ml/anomalies");
}

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 1, 2, 8) — `GET /api/v1/ml/forecasts/summary` or
 * `GET /api/v1/ml/anomalies/summary`, with each of the four scope keys `scope` sets: the fixed fact
 * sentences, one card per organization in scope that has any ML row.
 */
export async function fetchMlFindingsSummary(
  kind: MlFindingsKind,
  scope: ScopeFilter,
): Promise<MlFindingsSummaryResponse> {
  const sent = withAuth();
  const query = scopeParams(scope, SCOPE_FILTER_KEYS).toString();
  const res = await fetch(`${base}/api/v1/ml/${kind}/summary${query ? `?${query}` : ""}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml findings summary ${res.status}`, res.status);
  }
  return checkResponse(mlFindingsSummaryResponseSchema, await res.json(), `ml/${kind}/summary`);
}

/**
 * `E1.9d` (ADR 0135 Amendment 8 decisions 5 and 10; plan T4.1, R-c, R-n) —
 * `GET /api/v1/ml/findings/paragraph?kind=` with each of the four scope keys `scope` sets: the
 * AI-written paragraph of each organization card, `ok`, `none` or `pending`. The route never waits
 * for the provider, so a miss answers `pending` and the card asks again (`paragraphPollMs`). A
 * non-2xx still throws, so the read's error state (and its slow refetch) applies.
 */
export async function fetchMlFindingsParagraph(
  kind: MlFindingsKind,
  scope: ScopeFilter,
): Promise<MlFindingsParagraphResponse> {
  const sent = withAuth();
  const params = new URLSearchParams({ kind });
  for (const [key, value] of scopeParams(scope, SCOPE_FILTER_KEYS)) {
    params.set(key, value);
  }
  const res = await fetch(`${base}/api/v1/ml/findings/paragraph?${params.toString()}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`ml findings paragraph ${res.status}`, res.status);
  }
  // Fail closed (decision 5; security review L1): the paragraph is optional, so a malformed answer
  // is "no paragraph" in every build, never a throw that could blank the page. Only the parsed
  // value is returned, so nothing the schema does not name reaches the render.
  const parsed = mlFindingsParagraphResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : { cards: [] };
}
