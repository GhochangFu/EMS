import type { RtuHealthState } from "@bms/shared";

import { hostStateAt, hostSummaryFor, type HostBeat } from "./device-state";
import type { RtuHealthRow } from "./device-health.reads";

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

/** The `rtu_comms` alarm's text: the RTU's display name, else its code. */
export function rtuCommsMessage(row: Pick<RtuHealthRow, "displayName" | "code">): string {
  const name = row.displayName.trim() === "" ? row.code : row.displayName;
  return `Communication lost: ${name}`;
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
  const serving = rowsOfOrganization.flatMap((row) =>
    row.monitoredSinceMs !== null && row.hostKey !== null ? [row.hostKey] : [],
  );
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
