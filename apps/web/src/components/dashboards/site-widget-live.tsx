import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";

import type { DashboardWidgetDto } from "@bms/shared";

import { fetchVocabularies, vocabulariesQueryKey } from "../../api/vocabularies";
import { useSiteWidgets } from "../../hooks/use-site-widgets";
import type { WidgetStatus } from "../../lib/widget-catalog";
import { widgetTitle } from "../../lib/widget-value";
import { ActiveAlarmsRailWidget } from "../widgets/active-alarms-rail-widget";
import { AssetClassStripWidget } from "../widgets/asset-class-strip-widget";
import { CriticalSystemsListWidget } from "../widgets/critical-systems-list-widget";
import { ModuleSummaryCardWidget } from "../widgets/module-summary-card-widget";
import { StateLegendWidget } from "../widgets/state-legend-widget";

/** The five widget types `SiteWidgetLive` draws — the branch `DashboardWidgetLive` takes. */
export type SiteWidgetDto = Extract<
  DashboardWidgetDto,
  {
    widgetType:
      | "active_alarms_rail"
      | "state_legend"
      | "asset_class_strip"
      | "module_summary_card"
      | "critical_systems_list";
  }
>;

/** Whether a widget is one of the five, narrowing it for `DashboardWidgetLive`'s branch. */
export function isSiteWidget(widget: DashboardWidgetDto): widget is SiteWidgetDto {
  switch (widget.widgetType) {
    case "active_alarms_rail":
    case "state_legend":
    case "asset_class_strip":
    case "module_summary_card":
    case "critical_systems_list":
      return true;
    default:
      return false;
  }
}

type SiteWidgetLiveProps = {
  widget: SiteWidgetDto;
  dashboardId: string;
  /** The key of the tab the widget sits on; `null` on the Overview and on a legacy canvas. */
  tabKey: string | null;
};

/**
 * `F3.73` (plan D9) — one site widget's live binding. **One read per dashboard tab**
 * (`useSiteWidgets`, keyed on the dashboard and the tab): every site widget on a tab shares one
 * request and picks what it draws out of the response. The `/ws/alarms` refresh is not here: the
 * canvas holds one for all of them (`useSiteWidgetsAlarmRefresh`). The frame shows loading until the first
 * answer and the error line only when there is none — a failed refetch keeps the last good
 * drawing, as `MimicWidgetLive` does.
 *
 * The module card and the list link to `<site path>/<tab key>`, where the site path is the route
 * the widget is drawn under (`/control-room/site/:locationId`). Off that route there is no
 * `locationId` and they draw without a link.
 */
export function SiteWidgetLive({ widget, dashboardId, tabKey }: SiteWidgetLiveProps) {
  // The legend names the closed palette from the vocabulary and needs nothing from the read, so it
  // makes none: a hook cannot be skipped, hence a second component for the four that read.
  if (widget.widgetType === "state_legend") {
    return <StateLegendWidget title={widgetTitle(widget.title, widget.widgetType)} status="ready" />;
  }
  return <ReadingSiteWidget widget={widget} dashboardId={dashboardId} tabKey={tabKey} />;
}

function ReadingSiteWidget({
  widget,
  dashboardId,
  tabKey,
}: Omit<SiteWidgetLiveProps, "widget"> & { widget: Exclude<SiteWidgetDto, { widgetType: "state_legend" }> }) {
  const query = useSiteWidgets(dashboardId, tabKey);
  const vocabQ = useQuery({
    queryKey: vocabulariesQueryKey,
    queryFn: fetchVocabularies,
    staleTime: 5 * 60 * 1000,
  });
  const { locationId } = useParams();
  const sitePath = locationId === undefined ? null : `/control-room/site/${encodeURIComponent(locationId)}`;

  const title = widgetTitle(widget.title, widget.widgetType);
  const status: WidgetStatus = query.data !== undefined ? "ready" : query.isError ? "error" : "loading";
  const common = { title, status, data: query.data, severities: vocabQ.data?.alarmSeverities ?? [] };

  switch (widget.widgetType) {
    case "active_alarms_rail":
      return <ActiveAlarmsRailWidget {...common} config={widget.config} />;
    case "asset_class_strip":
      return <AssetClassStripWidget title={title} status={status} data={query.data} />;
    case "module_summary_card":
      return <ModuleSummaryCardWidget {...common} config={widget.config} sitePath={sitePath} />;
    case "critical_systems_list":
      return <CriticalSystemsListWidget {...common} sitePath={sitePath} />;
    default: {
      const unreachable: never = widget;
      return unreachable;
    }
  }
}
