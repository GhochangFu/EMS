import type { DashboardWidgetDto } from "@bms/shared";

import {
  widgetDataFor,
  type AssetWindowMs,
  type AggregateByKey,
  type CatalogResolution,
  type HistoryByRef,
  type LatestByRef,
} from "../../lib/dashboard-widget-data";
import { DashboardWidget } from "../widgets/dashboard-widget";
import { AnomalyWidgetLive } from "./anomaly-widget-live";
import { ForecastWidgetLive } from "./forecast-widget-live";
import { MimicWidgetLive } from "./mimic-widget-live";
import { MlFindingsWidgetLive, type MlFindingsWidgetScope } from "./ml-findings-widget-live";
import { isSiteWidget, SiteWidgetLive } from "./site-widget-live";
import { TrendStripWidgetLive, type TrendStripTabScope } from "./trend-strip-widget-live";

type DashboardWidgetLiveProps = {
  widget: DashboardWidgetDto;
  /** `F3.32` — the dashboard the widget sits on; a `mimic` reads its nodes by it. Required, so a
   * second host of this component cannot forget it and draw every node "Not assigned". */
  dashboardId: string;
  /** `F3.73` — the key of the tab the widget sits on, for the five site widgets' scoped read.
   * `null` on the Overview and on a legacy canvas. Required, like `dashboardId`, so a host that
   * forgets it cannot draw every tab's widgets from the Overview's scope. */
  tabKey: string | null;
  /** `F4.305` — the dashboard's own location, the site a `trend_strip` reads; `null` when the
   * dashboard has none. Required, like `tabKey`, so a second host cannot forget it and draw every
   * strip as "no site". */
  locationId: string | null;
  /** `F4.305` — the dashboard's tabs, so a `trend_strip`'s `config.tabKey` resolves to its group.
   * Required for the same reason. */
  tabs: readonly TrendStripTabScope[];
  /** `E1.9f` — the dashboard's own scope, the one an `ml_findings` widget reads. Required, like
   * `locationId`, so a second host cannot forget it and read every organization's findings. */
  scope: MlFindingsWidgetScope;
  latestByRef: LatestByRef;
  historyByRef: HistoryByRef;
  /** `F3.35` — the aggregate reads this dashboard needed. Empty for a dashboard that uses none. */
  aggregateByKey?: AggregateByKey;
  /** `F3.35` Stage C — the resolved catalog bindings. `undefined` for a dashboard binding none. */
  catalog?: CatalogResolution;
  now?: number;
  /** `F4.350`: an asset's freshness window in ms (`useAssetWindows`); absent = the 25 s floor for every asset. */
  windowMsFor?: AssetWindowMs;
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
 * **`F4.305` — and for the `trend_strip`** (`TrendStripWidgetLive`, the `F4.301` strip's read).
 * **`E1.4c` — and for the `forecast`** (`ForecastWidgetLive`: its own aggregate and forecast reads;
 * `pointRefsFor` skips it, so nothing in the two maps is its).
 * **`E1.2d` — and for the `anomaly`** (`AnomalyWidgetLive`: its asset's anomaly read; skipped by
 * `pointRefsFor` too).
 * **`E1.9f` — and for the `ml_findings`** (`MlFindingsWidgetLive`: the findings of `scope`; it binds
 * nothing, so nothing in the two maps is its).
 */
export function DashboardWidgetLive({
  widget,
  dashboardId,
  tabKey,
  locationId,
  tabs,
  scope,
  latestByRef,
  historyByRef,
  aggregateByKey,
  catalog,
  now,
  windowMsFor,
}: DashboardWidgetLiveProps) {
  if (widget.widgetType === "mimic") {
    return <MimicWidgetLive widget={widget} dashboardId={dashboardId} />;
  }
  if (isSiteWidget(widget)) {
    return <SiteWidgetLive widget={widget} dashboardId={dashboardId} tabKey={tabKey} />;
  }
  if (widget.widgetType === "trend_strip") {
    return <TrendStripWidgetLive widget={widget} locationId={locationId} tabs={tabs} />;
  }
  if (widget.widgetType === "forecast") {
    return <ForecastWidgetLive widget={widget} />;
  }
  if (widget.widgetType === "anomaly") {
    return <AnomalyWidgetLive widget={widget} />;
  }
  if (widget.widgetType === "ml_findings") {
    return <MlFindingsWidgetLive widget={widget} scope={scope} />;
  }
  // Resolved ONCE and reused for both the staleness gate and the chart's rolling window — two
  // clock reads in one render pass could otherwise disagree by the render's own duration.
  const resolvedNow = now ?? Date.now();
  const data = widgetDataFor(widget, latestByRef, historyByRef, resolvedNow, aggregateByKey, catalog, windowMsFor);
  return <DashboardWidget widget={widget} data={data} now={resolvedNow} />;
}
