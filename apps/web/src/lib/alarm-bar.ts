import type { AlarmListItem, AlarmSeverityCount, AlarmSummaryResponse } from "@bms/shared";
import { matchPath } from "react-router-dom";

import type { AlarmReadScope } from "../api/alarms";

/**
 * `F4.357` (ADR 0130) — the alarm bar's pure rules: the page's scope, the
 * newest unacknowledged alarm, the counts in rank order and the labels. No
 * React, no fetch, so every rule has a spec under the web coverage gate.
 *
 * The thresholds are **ranks**, never severity names, because the severity
 * vocabulary is open (ADR 0032; ADR 0130 decision 6): rank >= 20 pops up,
 * rank >= 30 is "critical" for the blink and the tone.
 */

/** Decision 6: a new alarm of this rank or above opens the popup. */
export const ALARM_POPUP_MIN_RANK = 20;
/** Decisions 6, 9, 10: this rank or above blinks and sounds. */
export const ALARM_CRITICAL_MIN_RANK = 30;
/** Decisions 7, 16: the bar's list holds at most this many rows. */
export const ALARM_BAR_LIST_LIMIT = 50;
/** Decision 19, plan D10: the bar's height — `--alarm-bar-h` is `3rem`, and `tests/f4.357-alarm-bar-gate.test.ts` holds the two together. */
export const ALARM_BAR_HEIGHT_PX = 48;

/** Decision 5: what the bar counts on the current page. */
export type AlarmBarScope =
  | { readonly kind: "all" }
  | { readonly kind: "organization"; readonly organizationId: string }
  | { readonly kind: "location"; readonly locationId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decisions 5 and 20 — the scope of a path: `/control-room/org/<uuid>` is that
 * organization; `/control-room/site/<uuid>` and anything under it (a tab, the
 * wall's `?wall=1`, which is a query, not a path) is that location; every other
 * path, `/` and `/control-room` (Estate) included, and an id that is not a uuid,
 * is every alarm the user can read.
 */
export function alarmBarScopeOf(pathname: string): AlarmBarScope {
  const organization = matchPath("/control-room/org/:organizationId", pathname)?.params.organizationId;
  if (organization !== undefined && UUID.test(organization)) {
    return { kind: "organization", organizationId: organization };
  }
  const location = matchPath("/control-room/site/:locationId/*", pathname)?.params.locationId;
  if (location !== undefined && UUID.test(location)) {
    return { kind: "location", locationId: location };
  }
  return { kind: "all" };
}

/** One string per scope, so a scope change is a key change. */
export function alarmBarScopeKey(scope: AlarmBarScope): string {
  if (scope.kind === "organization") return `organization:${scope.organizationId}`;
  if (scope.kind === "location") return `location:${scope.locationId}`;
  return "all";
}

/**
 * The `api/alarms.ts` read argument. The all scope is an empty id list: it
 * sends no `assetIds`, so the API reads everything the caller can read.
 */
export function alarmReadScopeOf(scope: AlarmBarScope): AlarmReadScope {
  if (scope.kind === "organization") return { organizationId: scope.organizationId };
  if (scope.kind === "location") return { locationId: scope.locationId };
  return [];
}

/** Plan Q4: the list header names the scope. `/control-room` is the Estate. */
export function alarmBarScopeLabel(scope: AlarmBarScope, pathname: string): string {
  if (scope.kind === "organization") return "This organization";
  if (scope.kind === "location") return "This site and its sub-locations";
  if (matchPath("/control-room", pathname) !== null) return "Estate";
  return "All alarms you can read";
}

/**
 * Decision 2 — the alarm the bar names: among the unacknowledged ones, the
 * highest `severityRank`, then the newest `raisedAt`. `null` when every alarm
 * is acknowledged, or there is none.
 */
export function newestUnacknowledged(list: readonly AlarmListItem[]): AlarmListItem | null {
  let best: AlarmListItem | null = null;
  for (const alarm of list) {
    if (alarm.acknowledgedAt !== null || alarm.suppressed) continue;
    if (
      best === null ||
      alarm.severityRank > best.severityRank ||
      (alarm.severityRank === best.severityRank && Date.parse(alarm.raisedAt) > Date.parse(best.raisedAt))
    ) {
      best = alarm;
    }
  }
  return best;
}

/** Decision 2 — the summary rows, highest rank first (the API answers ascending). */
export function countsByRankDescending(summary: AlarmSummaryResponse): AlarmSeverityCount[] {
  return [...summary.items].sort((a, b) => b.rank - a.rank);
}

/** Decision 17 — the alarm's own location (the RTU's for `rtu_comms`), else the asset's site name. */
export function alarmLocationLabel(alarm: Pick<AlarmListItem, "locationName" | "siteName">): string | null {
  return alarm.locationName ?? alarm.siteName;
}

/**
 * `F4.359` U13 (ADR 0131 decisions 8, 19) — what "seen" and "muted" remember of an alarm: its id, or
 * `id@unsuppressedAt` once it has returned from a maintenance window, so the bar treats the return as
 * a new alarm (it pops up, blinks and sounds again). `suppressed` is read first: a row suppressed
 * again keeps its earlier `unsuppressedAt`. Within one return the key is stable, so a refresh or an
 * in-app navigation does not bring a closed alarm back.
 */
export function alarmSeenKey(alarm: Pick<AlarmListItem, "id" | "suppressed" | "unsuppressedAt">): string {
  return !alarm.suppressed && alarm.unsuppressedAt !== null ? `${alarm.id}@${alarm.unsuppressedAt}` : alarm.id;
}

/** U13 (decision 6): an alarm the bar acts on — unacknowledged and not suppressed by a maintenance window. */
function waitsForTheOperator(alarm: AlarmListItem): boolean {
  return alarm.acknowledgedAt === null && !alarm.suppressed;
}

/**
 * `F4.357` U6 (decisions 6, 7; plan D5) — the popup's rows: unacknowledged, not suppressed, of popup
 * rank, and not yet seen in this tab ({@link alarmSeenKey}); highest rank first, then the newest; at
 * most {@link ALARM_BAR_LIST_LIMIT}.
 */
export function popupRows(list: readonly AlarmListItem[], seenKeys: ReadonlySet<string>): AlarmListItem[] {
  return list
    .filter((alarm) => waitsForTheOperator(alarm) && alarm.severityRank >= ALARM_POPUP_MIN_RANK && !seenKeys.has(alarmSeenKey(alarm)))
    .sort((a, b) => b.severityRank - a.severityRank || Date.parse(b.raisedAt) - Date.parse(a.raisedAt))
    .slice(0, ALARM_BAR_LIST_LIMIT);
}

/**
 * Plan Q1 — "and N more active alarms": the scope's unacknowledged alarms of popup rank that the
 * list (at most 50) does not hold. Never negative: the summary and the list are two reads.
 */
export function moreActiveCount(summary: AlarmSummaryResponse, list: readonly AlarmListItem[]): number {
  const unacknowledged = summary.items
    .filter((row) => row.rank >= ALARM_POPUP_MIN_RANK)
    .reduce((sum, row) => sum + row.unacknowledged, 0);
  return Math.max(0, unacknowledged - list.length);
}

/**
 * `F4.357` U7 (decision 9) — the severity codes whose count blinks: those of an unacknowledged, not
 * suppressed alarm of rank >= {@link ALARM_CRITICAL_MIN_RANK} that this tab has not seen (by
 * {@link alarmSeenKey}). Close (seen) or an acknowledge stops it; a warning never blinks.
 */
export function blinkingSeverityCodes(list: readonly AlarmListItem[], seenKeys: ReadonlySet<string>): ReadonlySet<string> {
  return new Set(
    list
      .filter((alarm) => waitsForTheOperator(alarm) && alarm.severityRank >= ALARM_CRITICAL_MIN_RANK && !seenKeys.has(alarmSeenKey(alarm)))
      .map((alarm) => alarm.severity),
  );
}

/**
 * `F4.357` U8 (decisions 10, 11) — the unacknowledged, not suppressed alarms of rank >= 30: what the
 * tone is about, as {@link alarmSeenKey} keys (`F4.359` U13), so a muted alarm that returns from a
 * maintenance window sounds again.
 */
export function criticalUnacknowledgedIds(list: readonly AlarmListItem[]): string[] {
  return list.filter((alarm) => waitsForTheOperator(alarm) && alarm.severityRank >= ALARM_CRITICAL_MIN_RANK).map(alarmSeenKey);
}

/** U8 (plan D8) — the tone is wanted while one of them is not muted (`mutedKeys` holds seen keys). */
export function toneWanted(list: readonly AlarmListItem[], mutedKeys: ReadonlySet<string>): boolean {
  return criticalUnacknowledgedIds(list).some((key) => !mutedKeys.has(key));
}
