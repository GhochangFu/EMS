import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import type { MlFindingsKind, MlFindingsSummaryResponse } from "@bms/shared/contracts";

import { fetchMlFindingsSummary } from "../api/ml";
import { retryUnlessForbidden } from "../components/asset-history/history-format";
import { FORECAST_REFETCH_MS } from "../lib/forecast-series";
import { scopeKey } from "../lib/ml-findings";
import type { ScopeFilter } from "../lib/scope-filter";

/**
 * `E1.9b` (ADR 0135 Amendment 8 decisions 1 and 2; plan T2.4) — one summary read per kind, in the
 * order given. Read again every 15 minutes, the ML cycle's own pace; a 403 is final.
 */
export function useMlFindings(
  kinds: readonly MlFindingsKind[],
  scope: ScopeFilter,
  enabled = true,
): UseQueryResult<MlFindingsSummaryResponse>[] {
  const key = scopeKey(scope);
  return useQueries({
    queries: kinds.map((kind) => ({
      queryKey: ["ml-findings", "summary", kind, key] as const,
      queryFn: () => fetchMlFindingsSummary(kind, scope),
      refetchInterval: FORECAST_REFETCH_MS,
      retry: retryUnlessForbidden,
      enabled,
    })),
  });
}
