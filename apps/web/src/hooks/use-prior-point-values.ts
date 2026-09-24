import { useQuery } from "@tanstack/react-query";

import { fetchPointValuesAt } from "../api/telemetry";
import { priorInstantIso } from "../lib/prior-instant";

/** Not the ids — the minute-floored `at` joins the key at call time. */
export const priorPointValuesQueryPrefix = ["telemetry", "priorPointValues"] as const;

/**
 * `F3.28` task 2.6 — the "vs yesterday" reads (tasks 2.5, 2.7) behind one
 * `GET /telemetry/points/at-instant` call for every tracked ref at once.
 *
 * The query key carries `priorInstantIso(Date.now())`, minute-floored so the
 * key — and the cache entry — stays the same across renders inside one
 * minute; `refetchInterval: 60_000` then re-runs it once the minute rolls
 * over, picking up the new key rather than refetching the same stale `at`.
 *
 * With no refs there is nothing to ask about, the same reasoning
 * `useActiveAlarms` applies: an empty `refs` array would read as *every*
 * point rather than *none*, so the query does not run at all.
 *
 * **`isPending`, not `isLoading` (TanStack v5).** A disabled query — no refs
 * yet — is `isPending: true` but `isLoading: false`, because `isLoading` is
 * `isPending && isFetching` and a disabled query never fetches. Reading
 * `isLoading` here would render "loading" as a caller resolves its refs, then
 * silently never leave that state once they were empty. F3.28 slice 1 hit
 * this same trap.
 */
export function usePriorPointValues(refs: readonly string[]) {
  const at = priorInstantIso(Date.now());
  const enabled = refs.length > 0;
  const query = useQuery({
    queryKey: [...priorPointValuesQueryPrefix, at, refs],
    queryFn: () => fetchPointValuesAt(refs, at),
    enabled,
    refetchInterval: 60_000,
  });

  const byRef = new Map<string, number | null>();
  for (const item of query.data?.items ?? []) {
    byRef.set(item.pointRef, item.value);
  }

  return {
    byRef,
    isPending: query.isPending,
    status: query.status,
  };
}
