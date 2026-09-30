import type { DashboardWidgetDto } from "@bms/shared";

import {
  widgetDataFor,
  type AggregateByKey,
  type CatalogResolution,
  type HistoryByRef,
  type LatestByRef,
} from "../../lib/dashboard-widget-data";
import { DashboardWidget } from "../widgets/dashboard-widget";
import { MimicWidgetLive } from "./mimic-widget-live";
import { isSiteWidget, SiteWidgetLive } from "./site-widget-live";

type DashboardWidgetLiveProps = {
  widget: DashboardWidgetDto;
  /** `F3.32` — the dashboard the widget sits on; a `mimic` reads its nodes by it. Required, so a
   * second host of this component cannot forget it and draw every node "Not assigned". */
  dashboardId: string;
  /** `F3.73` — the key of the tab the widget sits on, for the five site widgets' scoped read.
   * `null` on the Overview and on a legacy canvas. Required, like `dashboardId`, so a host that
   * forgets it cannot draw every tab's widgets from the Overview's scope. */
  tabKey: string | null;
  latestByRef: LatestByRef;
  historyByRef: HistoryByRef;
  /** `F3.35` — the aggregate reads this dashboard needed. Empty for a dashboard that uses none. */
  aggregateByKey?: AggregateByKey;
  /** `F3.35` Stage C — the resolved catalog bindings. `undefined` for a dashboard binding none. */
  catalog?: CatalogResolution;
  now?: number;
};

/**
 * One widget's live data binding. `widgetDataFor` (`dashboard-widget-data.ts`)
 * maps the two resolved telemetry maps onto the `WidgetData`
 * `DashboardWidget` draws — kept out of `dashboard-canvas.tsx` so the canvas
 * stays pure layout and this one line of wiring is the only thing that would
 * need to change if the mapping seam ever moved.
 *
 * **`F3.32` — the one branch.** A `mimic` binds no point and no source, so `widgetDataFor` would
 * call it `"empty"`; it has its own read (`MimicWidgetLive`) and branches off BEFORE the mapping.
 * **`F3.73` — the same branch for the five site widgets** (`SiteWidgetLive`, one read per tab).
 */
export function DashboardWidgetLive({
  widget,
  dashboardId,
  tabKey,
  latestByRef,
  historyByRef,
  aggregateByKey,
  catalog,
  now,
}: DashboardWidgetLiveProps) {
  if (widget.widgetType === "mimic") {
    return <MimicWidgetLive widget={widget} dashboardId={dashboardId} />;
  }
  if (isSiteWidget(widget)) {
    return <SiteWidgetLive widget={widget} dashboardId={dashboardId} tabKey={tabKey} />;
  }
  // Resolved ONCE and reused for both the staleness gate and the chart's rolling window — two
  // clock reads in one render pass could otherwise disagree by the render's own duration.
  const resolvedNow = now ?? Date.now();
  const data = widgetDataFor(widget, latestByRef, historyByRef, resolvedNow, aggregateByKey, catalog);
  return <DashboardWidget widget={widget} data={data} now={resolvedNow} />;
}
