import { useQuery } from "@tanstack/react-query";

import { fetchSystemStatus } from "../api/system-status";

/**
 * `F3.30` (ADR 0075 decision 5, plan decision 8) — the footer indicator's
 * poll period. `refetchIntervalInBackground` is left at its default `false`:
 * a status the operator is not looking at need not keep polling.
 */
export const SYSTEM_STATUS_REFETCH_MS = 30_000;

/** `GET /api/v1/system/status`, polled every `SYSTEM_STATUS_REFETCH_MS`. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ["system", "status"],
    queryFn: fetchSystemStatus,
    refetchInterval: SYSTEM_STATUS_REFETCH_MS,
  });
}
