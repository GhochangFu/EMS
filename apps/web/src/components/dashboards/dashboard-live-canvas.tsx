import type { DashboardDto, DashboardWidgetDto } from "@bms/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";

import { useAssetWindows } from "../../hooks/use-asset-windows";
import { useDashboardTelemetry } from "../../hooks/use-dashboard-telemetry";
import { isKwOnly, visibleTiles, widgetPointKeys } from "../../lib/energy-widgets";
import { FRESH_MS } from "../../lib/schematic-telemetry";
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
  /**
   * `F4.375` (ADR 0133 Amendment 2 ruling 2, plan D9) — `false` on a site whose energy is not
   * shown: a widget whose every binding reads `kw` is not drawn and its point refs are not read;
   * a catalog source of it is still resolved server-side with the dashboard's others (the catalog
   * read is per dashboard). A uniform tile row closes the gap it leaves (`visibleTiles`). Default `true`; the Dashboards viewer passes
   * nothing, so it draws every stored widget (ruling Q3). Nothing stored changes.
   */
  energyShown?: boolean;
  /**
   * `E1.9f` (ADR 0135 Amendment 8 decision 13; plan Q4 (a)) — `true` on the control-room wall: an
   * `ml_findings` widget is not drawn there (neither ML findings surface is on the wall). The
   * `forecast` and `anomaly` widgets still draw. Default `false`.
   */
  wall?: boolean;
};

/** `E1.9f` (Q4 (a)) — the one widget kind the wall does not draw. */
const isWallHidden = (widget: DashboardWidgetDto): boolean => widget.widgetType === "ml_findings";

/**
 * `E1.2d` — an `anomaly` widget is never kW-only: its one point only names the asset (plan R16)
 * and is never drawn; the widget draws a unitless ML score, not kW, so it stays with energy off.
 */
const isKwOnlyWidget = (widget: DashboardWidgetDto): boolean =>
  widget.widgetType !== "anomaly" && isKwOnly(widgetPointKeys(widget));

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
export function DashboardLiveCanvas({
  dashboard: fullDashboard,
  tabKey,
  energyShown = true,
  wall = false,
}: DashboardLiveCanvasProps) {
  // `F3.73` — the selected tab's slice. The telemetry hook keys its reads on the slice's point refs,
  // not on this object, so a tab switch re-tracks only the refs the new tab shows.
  // `F4.375` (D9) — the kW-only filter runs here too, before `useDashboardTelemetry`, so a hidden
  // widget's point refs and asset windows are never read (its catalog source still rides the
  // dashboard's one catalog read, which the server resolves whole).
  // `E1.9f` (Q4 (a)) — on the wall the `ml_findings` tiles are dropped in the same pass; they are
  // not counted as energy-hidden (`wallHidden` counts them), and their gap is left as stored.
  const { dashboard, hiddenCount, wallHidden } = useMemo(() => {
    const tabId = tabKey === undefined ? undefined : fullDashboard.tabs.find((tab) => tab.key === tabKey)?.id;
    const slice =
      tabKey === undefined ? fullDashboard.widgets : fullDashboard.widgets.filter((widget) => widget.tabId === tabId);
    const visible = visibleTiles(slice, energyShown, isKwOnlyWidget);
    // The same array back when nothing is dropped, so an unchanged canvas keeps its DTO.
    const drawn =
      wall && visible.tiles.some(isWallHidden) ? visible.tiles.filter((widget) => !isWallHidden(widget)) : visible.tiles;
    return {
      dashboard: drawn === fullDashboard.widgets ? fullDashboard : { ...fullDashboard, widgets: [...drawn] },
      hiddenCount: visible.hidden,
      wallHidden: visible.tiles.length - drawn.length,
    };
  }, [fullDashboard, tabKey, energyShown, wall]);
  const { latestByRef, historyByRef, aggregateByKey, catalog } = useDashboardTelemetry(dashboard);
  const now = Date.now();
  // `F4.350` (ADR 0075 Amendment 3): each bound asset is aged on its own RTU's window. Until the
  // read answers (or if it fails) every asset keeps the 25 s floor.
  const boundAssetIds = useMemo(
    () => [...new Set(dashboard.widgets.flatMap((widget) => widget.points.map((point) => point.assetId)))],
    [dashboard.widgets],
  );
  const assetWindows = useAssetWindows(boundAssetIds);
  const windowMsFor = useCallback((assetId: string) => assetWindows.get(assetId) ?? FRESH_MS, [assetWindows]);
  const widestWindowMs = boundAssetIds.reduce((widest, id) => Math.max(widest, windowMsFor(id)), FRESH_MS);
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
    reportNewestRead(newestMs, widestWindowMs);
  }, [reportNewestRead, newestMs, widestWindowMs]);
  // `F3.73` — a widget's tab key, read through the dashboard's own tabs (`dashboardRowsFromDto`'s rule).
  const tabKeyById = new Map(dashboard.tabs.map((tab) => [tab.id, tab.key]));
  // `E1.9f` — the dashboard's own scope, the one an `ml_findings` widget reads.
  const dashboardScope = {
    organizationId: fullDashboard.organizationId,
    locationId: fullDashboard.locationId,
    assetGroupId: fullDashboard.assetGroupId,
    assetId: fullDashboard.assetId,
  };

  const tiles: WidgetTile[] = dashboard.widgets.map((widget) => ({
    key: widget.id,
    gridX: widget.gridX,
    gridY: widget.gridY,
    gridW: widget.gridW,
    gridH: widget.gridH,
    widget,
  }));

  if (tiles.length === 0 && hiddenCount > 0) {
    // `F4.375` (D10) — "no widgets yet" would be false and invites a duplicate.
    return (
      <p
        role="status"
        data-testid="site-energy-hidden-tab"
        className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted"
      >
        {`No widget on this ${tabKey === undefined ? "dashboard" : "tab"} is shown while energy is not shown for this site.`}
      </p>
    );
  }

  if (tiles.length === 0 && wallHidden > 0) {
    // `E1.9f` (Q4 (a)) — the wall leaves out this tab's findings widgets; "no widgets yet" would be
    // false. A neutral muted line, as the energy branch above.
    return (
      <p
        role="status"
        data-testid="wall-hidden-canvas"
        className="rounded border border-dashed border-line-strong p-4 text-xs text-ink-muted"
      >
        {`Nothing on this ${tabKey === undefined ? "dashboard" : "tab"} is shown on the wall.`}
      </p>
    );
  }

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
            locationId={fullDashboard.locationId}
            tabs={fullDashboard.tabs}
            scope={dashboardScope}
            latestByRef={latestByRef}
            historyByRef={historyByRef}
            aggregateByKey={aggregateByKey}
            catalog={catalog}
            now={now}
            windowMsFor={windowMsFor}
          />
        )}
      />
    </>
  );
}
