import type { DashboardDto, DashboardWidgetDto } from "@bms/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { useDashboardTelemetry } from "../../hooks/use-dashboard-telemetry";
import { siteWidgetsQueryPrefix, useSiteWidgetsAlarmRefresh } from "../../hooks/use-site-widgets";
import { newestReadMs } from "../../lib/wall-mode";
import { DashboardCanvas, type CanvasTile } from "./dashboard-canvas";
import { DashboardWidgetLive } from "./dashboard-widget-live";
import { useReportNewestRead } from "./newest-read-context";
import { isSiteWidget } from "./site-widget-live";

type DashboardLiveCanvasProps = {
  dashboard: DashboardDto;
  /**
   * `F3.73` plan D10 — the selected tab's key: only that tab's widgets render, and only theirs
   * are read. Absent (a dashboard with no tabs, on the viewer or the site view) renders every
   * widget, as before.
   * A key the dashboard has no tab for renders none — it fails closed, never to every tab.
   */
  tabKey?: string;
};

type WidgetTile = CanvasTile & { widget: DashboardWidgetDto };

/**
 * `F3.73` — the canvas's one `/ws/alarms` subscription for its site widgets, as a component so
 * the canvas mounts it only when a widget reads (a hook cannot be skipped). The legend reads
 * nothing, so a canvas of legends alone opens no socket.
 */
function SiteWidgetsAlarmRefresh() {
  useSiteWidgetsAlarmRefresh();
  return null;
}

/**
 * `F3.69` U1 — the viewer's live canvas, byte-moved out of
 * `DashboardViewerPage` (plan decision D2) so a second host — `SiteDashboardView`
 * (`F3.69` U2) — can render the same widgets, live socket overlay and empty
 * state without owning the viewer's route, header or Edit link.
 *
 * Holds exactly the embeddable half the plan names: `useDashboardTelemetry`,
 * `now` read fresh on every render (so the periodic re-render
 * `useDashboardTelemetry`'s own `staleTick` drives actually advances the
 * clock `widgetDataFor` ages readings against), the tile map, the
 * "This dashboard has no widgets yet." line (`F3.73`: "This tab has no widgets yet." for a
 * selected tab) and `DashboardCanvas` + `DashboardWidgetLive`. The caller owns the query,
 * loading and error states.
 */
export function DashboardLiveCanvas({ dashboard: fullDashboard, tabKey }: DashboardLiveCanvasProps) {
  // `F3.73` — the selected tab's slice. The telemetry hook keys its reads on the slice's point refs,
  // not on this object, so a tab switch re-tracks only the refs the new tab shows.
  const dashboard = useMemo(() => {
    if (tabKey === undefined) {
      return fullDashboard;
    }
    const tabId = fullDashboard.tabs.find((tab) => tab.key === tabKey)?.id;
    return { ...fullDashboard, widgets: fullDashboard.widgets.filter((widget) => widget.tabId === tabId) };
  }, [fullDashboard, tabKey]);
  const { latestByRef, historyByRef, aggregateByKey, catalog } = useDashboardTelemetry(dashboard);
  const now = Date.now();
  // `F3.77` plan D9 — the newest read on this canvas, for the wall frame's "Updated" line. The
  // site-widgets key is the one the tab's widgets read with (`null` for no tab). Not a
  // subscription: the canvas re-renders every `STALE_TICK_MS` (the telemetry hook's tick), which
  // re-reads it well inside `FRESH_MS`.
  const queryClient = useQueryClient();
  const siteWidgetsUpdatedAt = queryClient.getQueryState([
    ...siteWidgetsQueryPrefix,
    fullDashboard.id,
    tabKey ?? null,
  ])?.dataUpdatedAt;
  const newestMs = newestReadMs(
    {
      latestByRef,
      catalogResolvedAt: catalog?.resolvedAt ?? null,
      siteWidgetsUpdatedAt,
    },
    now,
  );
  const reportNewestRead = useReportNewestRead();
  // Reported from an effect keyed on the number, never during render: the reporter sets the
  // frame's state, and a render-time update of another component is a React error.
  useEffect(() => {
    reportNewestRead(newestMs);
  }, [reportNewestRead, newestMs]);
  // `F3.73` — a widget's tab key, read through the dashboard's own tabs (`dashboardRowsFromDto`'s rule).
  const tabKeyById = new Map(dashboard.tabs.map((tab) => [tab.id, tab.key]));

  const tiles: WidgetTile[] = dashboard.widgets.map((widget) => ({
    key: widget.id,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    widget,
  }));

  if (tiles.length === 0) {
    return (
      <p className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted">
        {tabKey === undefined ? "This dashboard has no widgets yet." : "This tab has no widgets yet."}
      </p>
    );
  }

  const readsSiteWidgets = dashboard.widgets.some(
    (widget) => isSiteWidget(widget) && widget.widgetType !== "state_legend",
  );

  return (
    <>
      {readsSiteWidgets ? <SiteWidgetsAlarmRefresh /> : null}
      <DashboardCanvas
        tiles={tiles}
        renderTile={(tile) => (
          <DashboardWidgetLive
            widget={tile.widget}
            dashboardId={dashboard.id}
            tabKey={tile.widget.tabId === null ? null : (tabKeyById.get(tile.widget.tabId) ?? null)}
            latestByRef={latestByRef}
            historyByRef={historyByRef}
            aggregateByKey={aggregateByKey}
            catalog={catalog}
            now={now}
          />
        )}
      />
    </>
  );
}
