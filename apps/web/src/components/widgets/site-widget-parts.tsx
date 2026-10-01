import { createContext } from "react";

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

/** `n` and its noun, singular for exactly one: "1 alarm", "0 alarms", "2 alarms". */
function countOf(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * A tab's counts, as the card and the list print them: "1 alarm · 0 offline · 6 assets". The nouns
 * are this file's own, so they agree with their count (critique: "1 alarms"); "offline" is an
 * adjective and does not change. OQ6's no-plural rule is about `asset_roles.label`, printed
 * verbatim by `assetClassText` — not about these.
 */
export function tabCountsText(status: NonNullable<SiteWidgetTab["status"]>): string {
  return [
    tabAlarmsText(status.activeAlarms),
    `${status.offlineAssets} offline`,
    countOf(status.assets, "asset", "assets"),
  ].join(" · ");
}

/** Builds the URL that opens one tab of the dashboard a site widget is drawn in. */
export type SiteTabHref = (tabKey: string) => string;

/**
 * The dashboard viewer's {@link SiteTabHref} (`?tab=<key>`), for the site widgets it draws. The site
 * page needs none: `SiteWidgetLive` builds its links from the route's `locationId`. Null elsewhere.
 */
export const SiteTabHrefContext = createContext<SiteTabHref | null>(null);

/** The URL of one tab under the site page: `<site path>/<tab key>`. */
export function siteTabHref(sitePath: string, tabKey: string): string {
  return `${sitePath}/${encodeURIComponent(tabKey)}`;
}

/** The severity tones that outrank an offline member — the server's `tabTone` rule. */
const TONES_ABOVE_OFFLINE: ReadonlySet<string> = new Set(["critical", "warning"]);

/**
 * A readable tab's status label — the one rule the pill and the tab marker (`F3.77`) share. The
 * label names what set the tone, the read's own (`tabOf`): the server raises a tab with an offline
 * member and no `critical` or `warning` alarm to `warning` (`tabTone`), so that tab reads "Offline"
 * — whether it has no alarm (critique: "NORMAL · 3 offline") or only a less urgent one, such as
 * `info` (never an amber "Info"). Otherwise the worst active severity's vocabulary label, else
 * "Normal".
 */
export function tabStatusLabel(
  status: NonNullable<SiteWidgetTab["status"]>,
  severities: readonly AlarmSeverityDto[],
): string {
  const worst =
    status.worstSeverity === null ? undefined : severities.find((severity) => severity.code === status.worstSeverity);
  // A code the vocabulary does not list (not loaded yet) keeps its alarm label: it may be critical.
  const alarmSetsTheTone = status.worstSeverity !== null && (worst === undefined || TONES_ABOVE_OFFLINE.has(worst.tone));
  return status.offlineAssets > 0 && !alarmSetsTheTone
    ? "Offline"
    : status.worstSeverity !== null
      ? (worst?.label ?? status.worstSeverity)
      : "Normal";
}

/** A tab's active alarm count, as the tab marker prints it: "1 alarm", "2 alarms". */
export function tabAlarmsText(activeAlarms: number): string {
  return countOf(activeAlarms, "alarm", "alarms");
}

/** What a tab marker says for a tab the caller cannot read — never a zero that reads as healthy. */
export const OUTSIDE_SCOPE_TEXT = "Outside scope";

/**
 * `F3.77` (plan D4) — a marked tab's accessible name: "HVAC, Warning, 2 alarms", or "HVAC, Outside
 * scope" when the caller can read none of its members (`status` null).
 */
export function tabAccessibleName(
  label: string,
  status: SiteWidgetTab["status"],
  severities: readonly AlarmSeverityDto[],
): string {
  return status === null
    ? `${label}, ${OUTSIDE_SCOPE_TEXT}`
    : `${label}, ${tabStatusLabel(status, severities)}, ${tabAlarmsText(status.activeAlarms)}`;
}

/** The tab's status pill, labelled by {@link tabStatusLabel}. */
export function TabStatusPill({
  status,
  severities,
}: {
  status: NonNullable<SiteWidgetTab["status"]>;
  severities: readonly AlarmSeverityDto[];
}) {
  return <StatusPill label={tabStatusLabel(status, severities)} tone={status.tone} />;
}
