import { useQuery } from "@tanstack/react-query";

import { fetchDashboardMimicNodes } from "../api/dashboard-mimic";

/** Nodes refetch every 30 s (owner ruling 7, plan D2) — a re-roled member appears without a remount. */
export const MIMIC_REFRESH_MS = 30_000;

/**
 * `F3.32` U4 — the one mimic-nodes read of a dashboard. Keyed on the dashboard, never the
 * widget: two mimics on one dashboard share one request (plan D1), and each picks its own entry
 * out of `widgets` by `widgetId`.
 */
export function useMimicNodes(dashboardId: string) {
  return useQuery({
    queryKey: ["dashboards", "mimic-nodes", dashboardId],
    queryFn: () => fetchDashboardMimicNodes(dashboardId),
    refetchInterval: MIMIC_REFRESH_MS,
  });
}
