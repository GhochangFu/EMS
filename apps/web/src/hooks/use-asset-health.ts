import { useQuery } from "@tanstack/react-query";

import {
  fetchAssetHealth,
  fetchAssetHealthInputs,
  fetchHealthBadActors,
  fetchHealthSummary,
  type HealthSummaryFilter,
} from "../api/asset-health";

/**
 * `E1.3` Unit 8 — `GET /api/v1/asset-health/assets/:assetId` (ADR 0050 +
 * Amendment 1). Disabled on an empty `assetId` rather than firing a request
 * that can only 404, following the guarded-`enabled` shape TanStack Query
 * gives a param that may not be ready yet.
 */
export function useAssetHealth(assetId: string) {
  return useQuery({
    queryKey: ["asset-health", "asset", assetId],
    queryFn: () => fetchAssetHealth(assetId),
    enabled: assetId.length > 0,
  });
}

/**
 * `GET /api/v1/asset-health/summary`, optionally narrowed to one location
 * and/or one organization (`F3.72`). Both fields are normalised to `null` in
 * the key so "the whole enterprise" is one stable cache entry rather than one
 * per omitted-argument call site, and each field is its own key slot so two
 * scopes never share an entry.
 */
export function useHealthSummary(filter: HealthSummaryFilter = {}) {
  const { locationId, organizationId } = filter;
  return useQuery({
    queryKey: ["asset-health", "summary", locationId ?? null, organizationId ?? null],
    queryFn: () => fetchHealthSummary(filter),
  });
}

/**
 * `E1.8b` (ADR 0050 Amendment 5) — one asset's SOW §4.3 inputs. Off for an empty id, and not
 * retried: a failed read leaves the health card exactly as it is without the inputs, so there is
 * nothing a retry would rescue in front of the reader.
 */
export function useAssetHealthInputs(assetId: string) {
  return useQuery({
    queryKey: ["asset-health", "inputs", assetId],
    queryFn: () => fetchAssetHealthInputs(assetId),
    enabled: assetId.length > 0,
    retry: false,
  });
}

/** The anomaly half moves hourly, so a 5-minute browser cache costs nothing (plan R-o). */
const BAD_ACTORS_STALE_MS = 5 * 60 * 1000;

/**
 * `E1.8b` — `GET /asset-health/bad-actors` for one scope, keyed like the summary so two scopes
 * never share an entry. **The `queryFn` is a thunk:** passed bare, TanStack would hand the fetcher
 * its own context object as the filter. `enabled` lets a caller skip the read when its summary
 * holds no scored asset.
 */
export function useHealthBadActors(filter: HealthSummaryFilter, enabled: boolean) {
  const { locationId, organizationId } = filter;
  return useQuery({
    queryKey: ["asset-health", "bad-actors", locationId ?? null, organizationId ?? null],
    queryFn: () => fetchHealthBadActors(filter),
    enabled,
    staleTime: BAD_ACTORS_STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
