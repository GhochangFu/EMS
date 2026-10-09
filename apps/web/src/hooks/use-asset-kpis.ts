import { useQuery } from "@tanstack/react-query";

import { fetchAssetKpis } from "../api/asset-kpis";

/**
 * `F2.33` (ADR 0097) — `GET /api/v1/assets/:assetId/kpis` at the API's default
 * window. Disabled on an empty `assetId`, the `useAssetHealth` shape.
 */
export function useAssetKpis(assetId: string) {
  return useQuery({
    queryKey: ["asset-kpis", assetId],
    queryFn: () => fetchAssetKpis(assetId),
    enabled: assetId.length > 0,
  });
}
