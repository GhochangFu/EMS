import { useQuery } from "@tanstack/react-query";

import { fetchAssetHealth, fetchHealthSummary } from "../api/asset-health";

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
 * `GET /api/v1/asset-health/summary`, optionally narrowed to one location.
 * `locationId` is normalised to `null` in the key so "the whole enterprise"
 * is one stable cache entry rather than one per omitted-argument call site.
 */
export function useHealthSummary(locationId?: string) {
  return useQuery({
    queryKey: ["asset-health", "summary", locationId ?? null],
    queryFn: () => fetchHealthSummary(locationId),
  });
}
