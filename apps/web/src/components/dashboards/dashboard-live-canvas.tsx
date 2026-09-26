import type { DashboardDto, DashboardWidgetDto } from "@bms/shared";

import { useDashboardTelemetry } from "../../hooks/use-dashboard-telemetry";
import { DashboardCanvas, type CanvasTile } from "./dashboard-canvas";
import { DashboardWidgetLive } from "./dashboard-widget-live";

type DashboardLiveCanvasProps = {
  dashboard: DashboardDto;
};

type WidgetTile = CanvasTile & { widget: DashboardWidgetDto };

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
 * "This dashboard has no widgets yet." line and `DashboardCanvas` +
 * `DashboardWidgetLive`. The caller owns the query, loading and error states.
 */
export function DashboardLiveCanvas({ dashboard }: DashboardLiveCanvasProps) {
  const { latestByRef, historyByRef, aggregateByKey, catalog } = useDashboardTelemetry(dashboard);
  const now = Date.now();

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
      <p className="rounded border border-dashed border-gray-300 p-4 text-xs text-bms-muted">
        This dashboard has no widgets yet.
      </p>
    );
  }

  return (
    <DashboardCanvas
      tiles={tiles}
      renderTile={(tile) => (
        <DashboardWidgetLive
          widget={tile.widget}
          latestByRef={latestByRef}
          historyByRef={historyByRef}
          aggregateByKey={aggregateByKey}
          catalog={catalog}
          now={now}
        />
      )}
    />
  );
}
