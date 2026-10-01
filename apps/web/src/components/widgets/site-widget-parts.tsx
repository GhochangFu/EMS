import type { AlarmSeverityDto, DashboardWidgetSpec, SiteWidgetsResponse, SiteWidgetTab } from "@bms/shared";

import type { WidgetStatus } from "../../lib/widget-catalog";
import { StatusPill } from "../status-pill";

/**
 * `F3.73` (plan D9, Task 3.5) — what the five site widgets share: their props, the tab counts
 * text, the tab link and the tab status pill. One widget per file (AGENTS.md §4.2); this file's
 * one component is {@link TabStatusPill}, which the module card and the critical-systems list
 * both draw.
 *
 * Each widget takes the one site-widgets response (`data`) and the frame state (`status`); none
 * reads anything. `SiteWidgetLive` (`components/dashboards/site-widget-live.tsx`) owns the read and
 * the vocabulary, and `DashboardWidget` draws them with no data for the static case — a `ready`
 * widget with `data` undefined draws its empty state, never a stale number.
 *
 * Types are `Extract`s over `DashboardWidgetSpec`: `apps/web` carries no `zod`, the
 * `widget-catalog.ts` rule.
 */
export type ActiveAlarmsRailConfig = Extract<DashboardWidgetSpec, { widgetType: "active_alarms_rail" }>["config"];
export type ModuleSummaryCardConfig = Extract<DashboardWidgetSpec, { widgetType: "module_summary_card" }>["config"];

/** The props every reading site widget takes. */
export type SiteWidgetCommon = {
  title: string;
  status: WidgetStatus;
  data: SiteWidgetsResponse | undefined;
  /** The severity vocabulary, for a status pill's label. */
  severities: readonly AlarmSeverityDto[];
};

/** The scrolling body inside each site widget's frame. */
export const SITE_WIDGET_BODY_CLASS = "min-h-0 flex-1 overflow-auto";

/** A tab's counts, as the card and the list print them — no plural logic, the `assetClassText` rule. */
export function tabCountsText(status: NonNullable<SiteWidgetTab["status"]>): string {
  return `${status.activeAlarms} alarms · ${status.offlineAssets} offline · ${status.assets} assets`;
}

/** The URL of one tab under the site page: `<site path>/<tab key>`. */
export function siteTabHref(sitePath: string, tabKey: string): string {
  return `${sitePath}/${encodeURIComponent(tabKey)}`;
}

/**
 * The tab's status pill: the worst active severity's vocabulary label, or "Normal" when no member
 * has an active alarm. The tone is the read's own (`tone` is `ok` for a null worst severity).
 */
export function TabStatusPill({
  status,
  severities,
}: {
  status: NonNullable<SiteWidgetTab["status"]>;
  severities: readonly AlarmSeverityDto[];
}) {
  const worst = status.worstSeverity;
  const label =
    worst === null ? "Normal" : (severities.find((severity) => severity.code === worst)?.label ?? worst);
  return <StatusPill label={label} tone={status.tone} />;
}
