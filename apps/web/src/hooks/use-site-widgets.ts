import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchSiteWidgets } from "../api/dashboard-site-widgets";
import { useAlarmsSocket } from "./use-alarms-socket";
import { catalogValuesQueryPrefix } from "./use-dashboard-telemetry";

/** The prefix, without the ids: one socket event refreshes every tab's entry. */
export const siteWidgetsQueryPrefix = ["dashboards", "site-widgets"] as const;

/**
 * `offlineCount` and each tab's status move with telemetry, which raises no event on
 * `/ws/alarms`, so the read also polls. 15 s is well inside the 25 s offline bound
 * (`useAssetRoleSummary`'s own reason).
 */
export const SITE_WIDGETS_REFETCH_MS = 15_000;

/**
 * `F3.73` (plan D9) — the one site-widgets read of a dashboard tab. Keyed on the dashboard AND the
 * tab, so every site widget on one tab shares one request and a widget on another tab reads its
 * own scope. Polls every {@link SITE_WIDGETS_REFETCH_MS}; the `/ws/alarms` refresh is
 * {@link useSiteWidgetsAlarmRefresh}'s, once per canvas, never once per widget.
 *
 * The query's `signal` reaches `fetch`, so a read an invalidation cancels is aborted rather than
 * left to finish at the server with its answer discarded.
 *
 * `F3.77` — `enabled` (default `true`) lets the tab markers (`useTabMarkers`) read nothing when the
 * dashboard has no stored tab. It is an option, not derived from a null `tabKey`: a widget on a
 * legacy canvas reads with `tabKey` null on purpose.
 */
export function useSiteWidgets(dashboardId: string, tabKey: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...siteWidgetsQueryPrefix, dashboardId, tabKey],
    queryFn: ({ signal }) => fetchSiteWidgets(dashboardId, tabKey, signal),
    refetchInterval: SITE_WIDGETS_REFETCH_MS,
    enabled: options.enabled ?? true,
  });
}

/**
 * `F3.73` — the ONE `/ws/alarms` subscription of a canvas that draws site widgets: each event
 * invalidates every site-widgets entry once (the rail and the worst severity move with alarms).
 * `DashboardLiveCanvas` mounts it once. A subscription per widget opened a socket per widget
 * (socket.io-client dials each `io()` of one namespace separately) and invalidated once per
 * widget, each call cancelling and restarting the reads — about N reads per event.
 *
 * The same event invalidates the catalog-values read too (critique: the Active alarms tile, a
 * `alarms.active.count` catalog binding on a 60 s poll, showed fewer alarms than the rail beside
 * it). By prefix, because the hook takes no dashboard id: only a MOUNTED entry refetches, and the
 * canvas that mounts this hook is the one whose catalog entry is mounted.
 */
export function useSiteWidgetsAlarmRefresh(): void {
  const qc = useQueryClient();
  useAlarmsSocket(() => {
    void qc.invalidateQueries({ queryKey: siteWidgetsQueryPrefix });
    void qc.invalidateQueries({ queryKey: catalogValuesQueryPrefix });
  });
}
