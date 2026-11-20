import type { RtuHealthState } from "@bms/shared";

import { hostStateAt, hostSummaryFor, type HostBeat } from "./device-state";
import { stateOf, type RtuHealthRow } from "./device-health.reads";

/**
 * `F3.16` / ADR 0127 decisions 5, 6, 11, 15, 16, 18 and 20 — when a device alarm
 * is owed, stated once for its two readers: the worker sweep that raises
 * (`device-health-sweep.service.ts`) and the lifecycle sweep that clears
 * (`alarms/alarm-lifecycle-device.ts`). Pure; every state comes from
 * `device-state.ts` (the RTU's through `stateOf` in `device-health.reads.ts`), so neither reader holds a second copy of the rule.
 *
 * The rows are the monitored RTUs (`readRtuHealthRows(db, { kind: "monitored" })`):
 * an RTU outside them is not monitored (decision 20) and owes nothing.
 */

/** Decision 15 (Q11). */
export const RTU_COMMS_SEVERITY = "warning";
export const INGEST_HOST_SEVERITY = "critical";

/** Decision 16: a device alarm clears after this long back to normal. */
export const DEVICE_ALARM_CLEAR_HOLD_SECONDS = 120;

/**
 * ADR 0127 Amendment 1 (owner ruling 2026-11-12): "Communication lost" also needs this much
 * silence, not only an Offline state. An RTU reporting every 10 s has a window at its 25 s floor,
 * so on AWS a normal 30–60 s pause (p99 gap 20–120 s over 24 h) read Offline and raised and
 * cleared the alarm every few minutes — LEPPLT1 four times in an hour, each a notification.
 * The display states keep the window; only the alarm waits.
 */
export const RTU_COMMS_RAISE_AFTER_SECONDS = 300;

/** Offline, and silent at least {@link RTU_COMMS_RAISE_AFTER_SECONDS}: the one raise test for `rtu_comms`. */
export function rtuCommsDue(state: RtuHealthState, silentSeconds: number | null): boolean {
  return state === "offline" && silentSeconds !== null && silentSeconds >= RTU_COMMS_RAISE_AFTER_SECONDS;
}

export const INGEST_HOST_ALARM_MESSAGE = "Ingest host not reporting";

/**
 * ADR 0127 Amendment 2 (`F3.89`, owner ruling 2026-11-20): the `ingest_host` alarm is raised only
 * after a serving host has been silent this long on the database clock. On AWS an ingest deploy
 * restart left the host silent ~40–70 s and raised a critical alarm in every organization (~20 a
 * day each). The host still reads stale after 30 s for everything else; only the raise waits.
 */
export const INGEST_HOST_RAISE_AFTER_SECONDS = 120;

/** Amendment 2: at most this many site names and RTU names, then "+N more". */
const INGEST_HOST_MESSAGE_NAMES = 5;
const INGEST_HOST_MESSAGE_NAME_CHARS = 64;
const INGEST_HOST_MESSAGE_CHARS = 500;

/** The RTU's display name, else its code. */
function rtuName(row: Pick<RtuHealthRow, "displayName" | "code">): string {
  return row.displayName.trim() === "" ? row.code : row.displayName;
}

/** The `rtu_comms` alarm's text: the RTU's display name, else its code. */
export function rtuCommsMessage(row: Pick<RtuHealthRow, "displayName" | "code">): string {
  return `Communication lost: ${rtuName(row)}`;
}

/** The host keys this organization's monitored RTUs name. */
function servingHostKeys(rowsOfOrganization: readonly RtuHealthRow[]): string[] {
  return [
    ...new Set(
      rowsOfOrganization.flatMap((row) => (row.monitoredSinceMs !== null && row.hostKey !== null ? [row.hostKey] : [])),
    ),
  ];
}

/**
 * Amendment 2's raise test for `ingest_host`: a serving host with no row (no beat to count from), or
 * one silent at least {@link INGEST_HOST_RAISE_AFTER_SECONDS} on the database clock. `null` when the
 * organization has no monitored RTU (decision 15). The per-RTU hold is {@link organizationHostReporting}'s,
 * not this: a host stale under the hold still holds the `rtu_comms` alarms (decision 6).
 */
export function ingestHostDue(
  rowsOfOrganization: readonly RtuHealthRow[],
  hosts: readonly HostBeat[],
  dbNowMs: number,
): boolean | null {
  const keys = servingHostKeys(rowsOfOrganization);
  if (keys.length === 0) {
    return null;
  }
  const byKey = new Map(hosts.map((h) => [h.hostKey, h]));
  return keys.some((key) => {
    const host = byKey.get(key);
    return host === undefined || (dbNowMs - host.lastBeatMs) / 1000 >= INGEST_HOST_RAISE_AFTER_SECONDS;
  });
}

function cut(name: string): string {
  return name.length > INGEST_HOST_MESSAGE_NAME_CHARS ? `${name.slice(0, INGEST_HOST_MESSAGE_NAME_CHARS - 1)}…` : name;
}

function capped(names: readonly string[], more: (n: number) => string): string {
  const shown = names.slice(0, INGEST_HOST_MESSAGE_NAMES).map(cut);
  const extra = names.length - shown.length;
  return extra > 0 ? [...shown, more(extra)].join(", ") : shown.join(", ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en");

/**
 * Amendment 2: the `ingest_host` alarm's text for one organization — the stopped hosts' keys, and
 * the monitored RTUs they serve (edge-served included) that were Online or Stale at the host's last
 * beat, with their sites. Built from this organization's rows only, so it never names another
 * organization's site or RTU. Fixed at raise time: `raiseDevice` never rewrites an open alarm.
 */
export function ingestHostMessage(
  rowsOfOrganization: readonly RtuHealthRow[],
  hostsByKey: ReadonlyMap<string, HostBeat>,
  dbNowMs: number,
): string {
  const stopped = servingHostKeys(rowsOfOrganization)
    .filter((key) => hostStateAt(hostsByKey.get(key), dbNowMs) !== "ok")
    .sort(byName);
  const stoppedSet = new Set(stopped);
  const active = rowsOfOrganization.filter((row) => {
    if (row.monitoredSinceMs === null || row.hostKey === null || !stoppedSet.has(row.hostKey)) {
      return false;
    }
    const state = stateOf(row, hostsByKey);
    return state === "online" || state === "stale";
  });
  const head = `${INGEST_HOST_ALARM_MESSAGE}: ${stopped.map(cut).join(", ")}`;
  if (active.length === 0) {
    return `${head} — no active RTUs`;
  }
  const sites = new Map<string, string>();
  for (const row of active) {
    sites.set(row.locationId, row.locationName);
  }
  const siteNames = [...sites.values()].sort(byName);
  const rtuNames = active.map(rtuName).sort(byName);
  const text =
    `${head} — ${plural(active.length, "RTU")} at ${plural(sites.size, "site")} stopped: ` +
    `${capped(siteNames, (n) => `+${n} more site${n === 1 ? "" : "s"}`)}; ` +
    `RTUs: ${capped(rtuNames, (n) => `+${n} more`)}`;
  return text.length > INGEST_HOST_MESSAGE_CHARS ? `${text.slice(0, INGEST_HOST_MESSAGE_CHARS - 1)}…` : text;
}

/**
 * The state of the ingest host serving one organization's monitored RTUs (edge-served included —
 * the ingest host receives their uplinks too), judged on the database clock. `null` when the
 * organization has no monitored RTU, so no host alarm is owed or can stand (decision 15).
 * `stale` and `never` (a host key the RTUs name but no host row) both read as not reporting.
 */
export function organizationHostReporting(
  rowsOfOrganization: readonly RtuHealthRow[],
  hosts: readonly HostBeat[],
  dbNowMs: number,
): boolean | null {
  const serving = servingHostKeys(rowsOfOrganization);
  if (serving.length === 0) {
    return null;
  }
  return hostSummaryFor(hosts, serving, dbNowMs).state === "ok";
}

/** Is the host serving this RTU fresh on the database clock? A stale host freezes the RTU's state (decision 6). */
export function rtuHostReporting(row: RtuHealthRow, hostsByKey: ReadonlyMap<string, HostBeat>, dbNowMs: number): boolean {
  return hostStateAt(row.hostKey === null ? undefined : hostsByKey.get(row.hostKey), dbNowMs) === "ok";
}

/** May this RTU carry an `rtu_comms` alarm at all? Monitored (it is in the rows) and cloud-served (decision 18). */
export function rtuCommsEligible(row: RtuHealthRow | undefined): row is RtuHealthRow {
  return row !== undefined && row.monitoredSinceMs !== null && !row.edgeServed;
}

/** The rows grouped by organization, in first-seen order. */
export function byOrganization(rows: readonly RtuHealthRow[]): Map<string, RtuHealthRow[]> {
  const grouped = new Map<string, RtuHealthRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.organizationId) ?? [];
    list.push(row);
    grouped.set(row.organizationId, list);
  }
  return grouped;
}
