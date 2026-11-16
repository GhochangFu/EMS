import { useQuery } from "@tanstack/react-query";

import type { AnomalyScore } from "@bms/shared";

import { fetchAssetAnomalies } from "../api/ml";
import { isForbidden, retryUnlessForbidden } from "../components/asset-history/history-format";
import { anomalyWindow } from "../lib/anomaly-series";
import { forecastRefetchMs } from "./use-point-forecasts";

/**
 * `E1.2b` / ADR 0135 Amendment 5 ruling 4(b) — one asset's anomaly scores over `window`, the
 * window the history read was served (`null` until it answers), asked in whole hours within the
 * route's cap (`anomalyWindow`). The scorer writes hourly, so the read is polled every 15
 * minutes, as the forecast is; the rounded window is the query key, so a live window reads again
 * when the hour turns. `enabled` is the page's `anomalyApplies` gate (R14).
 *
 * A failed read — first or later — is "no marks", never a banner, so a scorer outage cannot break
 * the history page; a 403 stops the re-poll and the focus refetch (the scope will not change).
 * Returns the scores, or `undefined` while loading, disabled or failed.
 */
export function useAssetAnomalies(
  assetId: string,
  window: { readonly from: string; readonly to: string } | null,
  enabled: boolean,
): readonly AnomalyScore[] | undefined {
  const on = enabled && assetId !== "" && window !== null;
  const asked = window === null ? { from: "", to: "" } : anomalyWindow(window);
  const result = useQuery({
    queryKey: ["asset-anomalies", assetId, asked.from, asked.to],
    queryFn: () => fetchAssetAnomalies(assetId, asked.from, asked.to),
    enabled: on,
    refetchInterval: (query) => forecastRefetchMs(query.state.error),
    refetchOnWindowFocus: (query) => !isForbidden(query.state.error),
    retry: retryUnlessForbidden,
  });
  return on && !result.isError ? result.data?.scores : undefined;
}
