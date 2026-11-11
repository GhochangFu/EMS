import { CLOCK_SKEW_HIGHLIGHT_SECONDS, assetLabelOf } from "@bms/shared";
import type { DropFirst, DropReason, RtuDropCount, RtuHealthDto, RtuHealthState } from "@bms/shared";

/**
 * `F3.16` / ADR 0127 decisions 4, 16, 18 and 20 — the strings and tones the
 * admin RTUs page and its drop-history drawer render for device health. Pure,
 * so the page and the drawer say the same thing.
 *
 * Device-supplied strings (`sourceKey`, `pointKey`, device keys) are returned
 * as plain strings and rendered as React text children, never as HTML
 * (decision 8).
 */

export type HealthPillTone = "ok" | "warning" | "critical" | "offline" | "info";

export const RTU_HEALTH_LABELS: Record<RtuHealthState, string> = {
  online: "Online",
  stale: "Stale",
  offline: "Offline",
  not_monitored: "Not monitored",
};

export const RTU_HEALTH_TONES: Record<RtuHealthState, HealthPillTone> = {
  online: "ok",
  stale: "warning",
  offline: "critical",
  not_monitored: "offline",
};

export const DROP_REASON_LABELS: Record<DropReason, string> = {
  badQuality: "Bad quality",
  nonFinite: "Not a finite number",
  unknownDevice: "Unknown device",
  unmappedSourceKey: "Unmapped source key",
  ambiguousDevice: "Ambiguous device",
  outOfRange: "Out of range",
};

/** The banner the RTUs page shows while the ingest host is not reporting (decision 16). */
export const INGEST_HOST_BANNER = "Ingest host not reporting — device states are frozen at its last heartbeat.";

/** `"12 s ago"`, `"5 min ago"`, `"3 h ago"`, `"2 d ago"`; `"Never"` for no sample. */
export function lastSeenRelative(iso: string | null, nowMs: number): string {
  if (iso === null) return "Never";
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** The absolute instant, for the cell's `title`. */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** `"+12 s"`, `"-400 s"`, `"0 s"`; `"—"` when no sample carried a device time. */
export function clockSkewText(seconds: number | null): string {
  if (seconds === null) return "—";
  return seconds > 0 ? `+${seconds} s` : `${seconds} s`;
}

/** Highlighted strictly beyond ±`CLOCK_SKEW_HIGHLIGHT_SECONDS`; exactly 300 is not. */
export function clockSkewHighlighted(seconds: number | null): boolean {
  return seconds !== null && Math.abs(seconds) > CLOCK_SKEW_HIGHLIGHT_SECONDS;
}

/**
 * `"<asset label> · <point key>"` (the asset named by `assetLabelOf`, ADR 0111), or the point
 * key, or the source key; `null` when nothing names it.
 */
export function firstDroppedLabel(first: DropFirst | null): string | null {
  if (first === null) return null;
  if (first.pointKey !== null) {
    if (first.assetCode === null) return first.pointKey;
    const asset = assetLabelOf({
      assetCode: first.assetCode,
      assetRtuName: first.assetRtuName,
      assetLocationName: first.assetLocationName,
    });
    return `${asset} · ${first.pointKey}`;
  }
  return first.sourceKey;
}

/**
 * The 24 h total across reasons, and the earliest dropped sample: the reasons are taken in
 * `firstAt` order (a tie keeps the given order), and the first that names something wins.
 */
export function dropsSummary(drops: readonly RtuDropCount[]): { total: number; first: string | null } {
  let total = 0;
  for (const drop of drops) total += drop.count;
  const earliestFirst = [...drops].sort((a, b) => Date.parse(a.firstAt) - Date.parse(b.firstAt));
  let first: string | null = null;
  for (const drop of earliestFirst) {
    first = firstDroppedLabel(drop.first);
    if (first !== null) break;
  }
  return { total, first };
}

export type DeviceHealthCounts = { monitored: number; online: number; stale: number; offline: number };

/** The RTUs page header tiles: a "Not monitored" RTU counts in none of them (decision 20). */
export function deviceHealthCounts(items: readonly RtuHealthDto[]): DeviceHealthCounts {
  const counts: DeviceHealthCounts = { monitored: 0, online: 0, stale: 0, offline: 0 };
  for (const item of items) {
    if (item.state === "not_monitored") continue;
    counts.monitored += 1;
    counts[item.state] += 1;
  }
  return counts;
}
