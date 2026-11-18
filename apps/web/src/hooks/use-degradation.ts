import { useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";

import type { DegradationResponse } from "@bms/shared/contracts";

import { fetchAssetDegradation, fetchDegradation } from "../api/degradation";
import { retryUnlessForbidden, isForbidden } from "../components/asset-history/history-format";
import { DEGRADATION_STALE_MS } from "../lib/degradation";
import type { ScopeFilter } from "../lib/scope-filter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `E1.5b` / ADR 0138 (plan T2.1) — one asset's degradation, for its history page. An id that is not
 * a uuid asks nothing; a 403 is not retried or refetched, on focus or on a remount (the scope will not change). A failed read
 * — first or later — is `undefined`, never an error to the caller (R-p). Returns the response, or
 * `undefined` while loading or failed.
 */
export function useAssetDegradation(assetId: string): DegradationResponse | undefined {
  const on = UUID.test(assetId);
  const result = useQuery({
    queryKey: ["asset-degradation", assetId],
    queryFn: () => fetchAssetDegradation(assetId),
    enabled: on,
    staleTime: DEGRADATION_STALE_MS,
    gcTime: DEGRADATION_STALE_MS,
    refetchOnMount: (query) => !isForbidden(query.state.error),
    refetchOnWindowFocus: (query) => !isForbidden(query.state.error),
    retry: retryUnlessForbidden,
  });
  return on && !result.isError ? result.data : undefined;
}

/**
 * `E1.5b` / ADR 0138 (plan T2.1, R-q) — the control-room list, kept 15 minutes per scope. The
 * `queryFn` is a thunk: React Query passes its context to a bare function, which `fetchDegradation`
 * would read as the filter. The key carries only the two keys the server reads.
 */
export function useDegradationList(filter: ScopeFilter, enabled: boolean): UseQueryResult<DegradationResponse> {
  return useQuery({
    queryKey: ["degradation", "list", filter.locationId ?? null, filter.organizationId ?? null],
    queryFn: () => fetchDegradation(filter),
    enabled,
    // Kept for the 15 minutes even while no page shows it (R-q): the default 5-minute
    // garbage collection would make a return visit recompute the heavy route.
    staleTime: DEGRADATION_STALE_MS,
    gcTime: DEGRADATION_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
