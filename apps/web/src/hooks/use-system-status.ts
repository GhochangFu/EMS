import { useQuery } from "@tanstack/react-query";

import { fetchSystemStatus } from "../api/system-status";

/**
 * `F3.30` (ADR 0075 decision 5, plan decision 8) — the footer indicator's
 * poll period. `refetchIntervalInBackground` is left at its default `false`:
 * a status the operator is not looking at need not keep polling.
 */
export const SYSTEM_STATUS_REFETCH_MS = 30_000;

/**
 * `GET /api/v1/system/status`, polled every `SYSTEM_STATUS_REFETCH_MS`.
 *
 * `retry: 1` overrides the app-wide `shouldRetryQuery` (`main.tsx`) on
 * purpose (owner ruling 2026-09-25): with the client's 10 s timeout, a hung
 * API reads "Status unavailable" after one timeout, a 1 s retry delay and a
 * second timeout — about 21 s — rather than the four attempts and backoff
 * the default rule allows. The query's `signal` is passed through so a
 * cancelled query aborts its request.
 */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["system", "status"],
    queryFn: ({ signal }) => fetchSystemStatus(signal),
    refetchInterval: SYSTEM_STATUS_REFETCH_MS,
    retry: 1,
  });
}
