import { useQueries, useQueryClient, type QueryKey, type UseQueryResult } from "@tanstack/react-query";

import type {
  MlFindingsKind,
  MlFindingsParagraphResponse,
  MlFindingsSummaryResponse,
} from "@bms/shared/contracts";

import { fetchMlFindingsParagraph, fetchMlFindingsSummary } from "../api/ml";
import { retryUnlessForbidden } from "../components/asset-history/history-format";
import { FORECAST_REFETCH_MS } from "../lib/forecast-series";
import { paragraphPollMs, scopeKey } from "../lib/ml-findings";
import { shouldRetryQuery } from "../lib/query-retry";
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

/** The cached paragraph read: the answer, and how many answers in a row held a `pending` card. */
type ParagraphRead = { readonly response: MlFindingsParagraphResponse; readonly pendingAnswers: number };

/**
 * `E1.9d` (ADR 0135 Amendment 8 decision 5; plan T4.3, R-n, R-q) — one paragraph read per kind,
 * each only while its `enabled` entry is true (the caller asks only when the summary has a card
 * with findings). The route never waits for the provider, so while any card is `pending` the read
 * asks again every 4 s, at most 6 times in a row (`paragraphPollMs`), then every 15 minutes. The
 * count lives in the cached data, so every observer of one key shares one bound. TanStack's
 * default stops the interval in a hidden browser tab (R-q).
 */
export function useMlFindingsParagraphs(
  kinds: readonly MlFindingsKind[],
  scope: ScopeFilter,
  enabled: readonly boolean[],
): UseQueryResult<MlFindingsParagraphResponse>[] {
  const client = useQueryClient();
  const key = scopeKey(scope);
  return useQueries({
    queries: kinds.map((kind, index) => ({
      queryKey: ["ml-findings", "paragraph", kind, key] as QueryKey,
      queryFn: async ({ queryKey }: { queryKey: QueryKey }): Promise<ParagraphRead> => {
        const response = await fetchMlFindingsParagraph(kind, scope);
        const waiting = response.cards.some((card) => card.state === "pending");
        const before = client.getQueryData<ParagraphRead>(queryKey)?.pendingAnswers ?? 0;
        return { response, pendingAnswers: waiting ? before + 1 : 0 };
      },
      select: (read: ParagraphRead) => read.response,
      refetchInterval: (query: { state: { data: ParagraphRead | undefined; status: string } }) => {
        // A failed read keeps its last data, which may hold a `pending` card: it must not keep the
        // 4 s pace (the review's probe measured 258 requests in 10 minutes). Back to 15 minutes.
        if (query.state.status === "error") {
          return FORECAST_REFETCH_MS;
        }
        const read = query.state.data;
        // The first `pending` answer is the first ask, not an ask again.
        return paragraphPollMs(read?.response, Math.max(0, (read?.pendingAnswers ?? 0) - 1));
      },
      // The app default: no retry of a 4xx refusal; the 15-minute refetch asks again anyway.
      retry: shouldRetryQuery,
      enabled: enabled[index] ?? false,
    })),
  });
}
