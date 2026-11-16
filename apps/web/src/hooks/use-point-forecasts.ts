import { useQueries } from "@tanstack/react-query";

import { encodePointRef } from "@bms/shared";
import type { PointForecastResponse } from "@bms/shared";

import { fetchPointForecast } from "../api/ml";
import { isForbidden, retryUnlessForbidden } from "../components/asset-history/history-format";
import { FORECAST_REFETCH_MS } from "../lib/forecast-series";

export { FORECAST_REFETCH_MS };

/** The re-poll for one point: every 15 minutes, or never again after a 403 (the scope will not change). */
export function forecastRefetchMs(error: unknown): number | false {
  return isForbidden(error) ? false : FORECAST_REFETCH_MS;
}

export interface PointForecastRead {
  readonly pointKey: string;
  /**
   * The server's answer, or `undefined` while loading or once a read has failed — a later
   * refetch's failure too: TanStack keeps the previous data on error, and a last-known forecast
   * would otherwise stay drawn, with its old `stale: false`, after it is hours old.
   */
  readonly data: PointForecastResponse | undefined;
}

/**
 * `E1.4a` — one forecast read per charted point, in parallel, refetched every 15 minutes. No
 * WebSocket push: the scorer writes hourly. A failed read is "no forecast", never a page error:
 * the caller draws nothing for that point and shows no banner, so a scorer outage cannot break
 * the history page. `enabled` is the page's `forecastApplies` gate (R7, R-d), so a past range or
 * a `sum`/`max` page asks for nothing. A 403 stops the 15-minute re-poll and the focus refetch for
 * that point: the scope will not change under an open page, and the history page promises a 403
 * no retry loop.
 */
export function usePointForecasts(
  assetId: string,
  pointKeys: readonly string[],
  enabled: boolean,
): PointForecastRead[] {
  const results = useQueries({
    queries: pointKeys.map((pointKey) => {
      const ref = encodePointRef(assetId, pointKey);
      return {
        queryKey: ["point-forecast", ref],
        queryFn: () => fetchPointForecast(ref),
        enabled: enabled && assetId !== "",
        refetchInterval: (query: { state: { error: unknown } }) => forecastRefetchMs(query.state.error),
        refetchOnWindowFocus: (query: { state: { error: unknown } }) => !isForbidden(query.state.error),
        retry: retryUnlessForbidden,
      };
    }),
  });
  return pointKeys.map((pointKey, index) => ({
    pointKey,
    data: enabled && results[index]?.isError !== true ? results[index]?.data : undefined,
  }));
}
