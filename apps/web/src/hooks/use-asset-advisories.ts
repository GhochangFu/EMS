import { useQuery } from "@tanstack/react-query";

import type { Advisory } from "@bms/shared/contracts";

import { fetchAssetAdvisories } from "../api/advisories";
import { isForbidden, retryUnlessForbidden } from "../components/asset-history/history-format";
import { ADVISORIES_REFETCH_MS } from "../lib/advisories";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `E1.6b` / ADR 0137 (plan T2.5) — one asset's advisories, for its history page. Read again every
 * 15 minutes until a 403 (the scope will not change). An id that is not a uuid asks nothing.
 *
 * A failed read — first or later — is "no advisories", never a banner (R-l), so the advisory read
 * cannot break the history page. Returns the advisories, or `undefined` while loading or failed.
 */
export function useAssetAdvisories(assetId: string): readonly Advisory[] | undefined {
  const on = UUID.test(assetId);
  const result = useQuery({
    queryKey: ["asset-advisories", assetId],
    queryFn: () => fetchAssetAdvisories(assetId),
    enabled: on,
    refetchInterval: (query) => (isForbidden(query.state.error) ? false : ADVISORIES_REFETCH_MS),
    refetchOnWindowFocus: (query) => !isForbidden(query.state.error),
    retry: retryUnlessForbidden,
  });
  return on && !result.isError ? result.data?.advisories : undefined;
}
