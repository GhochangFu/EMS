import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchAssetRoleSummary } from "../api/assets";
import { useAlarmsSocket } from "./use-alarms-socket";

/** The prefix, without the ids: one socket event refreshes every scope's entry. */
export const assetRoleSummaryQueryPrefix = ["assets", "role-summary"] as const;

/**
 * `offlineCount` moves with telemetry, which raises no event on `/ws/alarms`,
 * so the read also polls. 15 s is well inside the 25 s offline bound (OQ1).
 */
export const ASSET_ROLE_SUMMARY_REFETCH_MS = 15_000;

/**
 * The read behind the `/cr-overview` class strip (`F3.28`, ADR 0074, plan task
 * 3.3): per asset role, the count, the worst active severity and how many sit
 * at it, and the offline count — narrowed to `assetIds`.
 *
 * Refreshes on every `/ws/alarms` event (the worst severity moves with alarms)
 * and every {@link ASSET_ROLE_SUMMARY_REFETCH_MS} (the offline count moves
 * with telemetry).
 *
 * With no ids the query does not run — the same rule as `useActiveAlarms`:
 * sending no `assetIds` would mean *every readable asset*, a wider read than
 * the strip describes.
 */
export function useAssetRoleSummary(assetIds: readonly string[]) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...assetRoleSummaryQueryPrefix, assetIds],
    queryFn: () => fetchAssetRoleSummary(assetIds),
    enabled: assetIds.length > 0,
    refetchInterval: ASSET_ROLE_SUMMARY_REFETCH_MS,
  });
  useAlarmsSocket(() => {
    void qc.invalidateQueries({ queryKey: assetRoleSummaryQueryPrefix });
  });
  return query;
}
