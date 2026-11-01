import type { DashboardWidgetDto, TrendStripWidgetConfig } from "@bms/shared";

import { widgetTitle } from "../../lib/widget-value";
import { TrendStripWidget } from "../widgets/trend-strip-widget";

/** What the widget reads of a dashboard tab: its key and the asset group it binds. */
export type TrendStripTabScope = { readonly key: string; readonly assetGroupId: string | null };

/**
 * `F4.305` (plan call C1, owner answer 2026-11-01) — the group a `trend_strip` reads: the one the
 * tab its `config.tabKey` names binds. No `tabKey`, a tab that binds no group, or a key the
 * dashboard has no tab for is the whole site (`null`).
 */
export function trendStripGroupFor(
  config: TrendStripWidgetConfig,
  tabs: readonly TrendStripTabScope[],
): string | null {
  if (config.tabKey === undefined) {
    return null;
  }
  return tabs.find((tab) => tab.key === config.tabKey)?.assetGroupId ?? null;
}

type TrendStripWidgetLiveProps = {
  widget: Extract<DashboardWidgetDto, { widgetType: "trend_strip" }>;
  /** The dashboard's own location — the site the strip reads; `null` reads nothing. */
  locationId: string | null;
  /** The dashboard's tabs, for {@link trendStripGroupFor}. */
  tabs: readonly TrendStripTabScope[];
};

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, items 1–3; plan call C7) — one `trend_strip` widget's live
 * binding: the site is the dashboard's location, the group comes from the tab its config names.
 * The read itself is the `F4.301` strip's (`TrendStripBody`), so there is one read and one click.
 */
export function TrendStripWidgetLive({ widget, locationId, tabs }: TrendStripWidgetLiveProps) {
  return (
    <TrendStripWidget
      title={widgetTitle(widget.title, widget.widgetType)}
      locationId={locationId}
      assetGroupId={trendStripGroupFor(widget.config, tabs)}
      defaultRange={widget.config.defaultRange}
    />
  );
}
