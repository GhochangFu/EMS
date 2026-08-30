import type { DashboardWidgetDto } from "@bms/shared";

import { widgetDataFor, type HistoryByRef, type LatestByRef } from "../../lib/dashboard-widget-data";
import { DashboardWidget } from "../widgets/dashboard-widget";

type DashboardWidgetLiveProps = {
  widget: DashboardWidgetDto;
  latestByRef: LatestByRef;
  historyByRef: HistoryByRef;
  now?: number;
};

/**
 * One widget's live data binding. `widgetDataFor` (`dashboard-widget-data.ts`)
 * maps the two resolved telemetry maps onto the `WidgetData`
 * `DashboardWidget` draws — kept out of `dashboard-canvas.tsx` so the canvas
 * stays pure layout and this one line of wiring is the only thing that would
 * need to change if the mapping seam ever moved.
 */
export function DashboardWidgetLive({ widget, latestByRef, historyByRef, now }: DashboardWidgetLiveProps) {
  // Resolved ONCE and reused for both the staleness gate and the chart's rolling window — two
  // clock reads in one render pass could otherwise disagree by the render's own duration.
  const resolvedNow = now ?? Date.now();
  const data = widgetDataFor(widget, latestByRef, historyByRef, resolvedNow);
  return <DashboardWidget widget={widget} data={data} now={resolvedNow} />;
}
