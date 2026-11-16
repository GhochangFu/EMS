import { useQueries } from "@tanstack/react-query";

import { encodePointRef } from "@bms/shared";
import type { PastForecastBucket } from "@bms/shared";

import { fetchPastForecast } from "../api/ml";
import { isForbidden, retryUnlessForbidden } from "../components/asset-history/history-format";

export interface PastForecastRead {
  readonly pointKey: string;
  /** The past buckets, or `undefined` while loading or once a read has failed (as `usePointForecasts`). */
  readonly buckets: readonly PastForecastBucket[] | undefined;
}

/**
 * `E1.4e` / ADR 0135 Amendment 4 — one past-forecast read per charted point, over `window`, the
 * window the actual read was served (`null` until it answers). The window is in the query key, so
 * a live window that moves (its own 15-minute refresh) reads again and nothing else re-polls. A
 * failed read is "no past line", never a page error; a 403 is final, as for the live forecast.
 */
export function usePastForecasts(
  assetId: string,
  pointKeys: readonly string[],
  window: { readonly from: string; readonly to: string } | null,
  enabled: boolean,
): PastForecastRead[] {
  const on = enabled && assetId !== "" && window !== null;
  const results = useQueries({
    queries: pointKeys.map((pointKey) => {
      const ref = encodePointRef(assetId, pointKey);
      return {
        queryKey: ["past-forecast", ref, window?.from ?? "", window?.to ?? ""],
        queryFn: () => fetchPastForecast(ref, window?.from ?? "", window?.to ?? ""),
        enabled: on,
        refetchOnWindowFocus: (query: { state: { error: unknown } }) => !isForbidden(query.state.error),
        retry: retryUnlessForbidden,
      };
    }),
  });
  return pointKeys.map((pointKey, index) => ({
    pointKey,
    buckets: on && results[index]?.isError !== true ? results[index]?.data?.buckets : undefined,
  }));
}
