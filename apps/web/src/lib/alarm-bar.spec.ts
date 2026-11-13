import type { AlarmListItem, AlarmSummaryResponse } from "@bms/shared";
import { expect } from "vitest";

import {
  alarmBarScopeKey,
  alarmBarScopeLabel,
  alarmBarScopeOf,
  alarmLocationLabel,
  alarmReadScopeOf,
  blinkingSeverityCodes,
  countsByRankDescending,
  moreActiveCount,
  newestUnacknowledged,
  popupRows,
} from "./alarm-bar";

/**
 * `F4.357` U3 (ADR 0130 decisions 2, 5, 17, 20) — the alarm bar's pure rules.
 * Vitest entry point: `alarm-bar.test.ts` (ADR 0014).
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";

/** A complete list item; `over` sets the fields a case is about. */
export function alarmItem(over: Partial<AlarmListItem> = {}): AlarmListItem {
  return {
    id: "a1",
    assetId: "30000000-0000-4000-8000-000000000001",
    ruleKey: null,
    ruleId: null,
    severity: "critical",
    message: "High temperature",
    raisedAt: "2026-11-12T10:00:00.000Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    assetCode: "CH-01",
    assetRtuName: null,
    assetLocationName: "Plant A",
    assetName: "Chiller 1",
    siteName: "Site A",
    source: "rule",
    rtuId: null,
    rtuCode: null,
    severityRank: 30,
    suppressed: false,
    maintenanceWindowId: null,
    unsuppressedAt: null,
    locationName: "Plant A",
    ...over,
  };
}

/** Decisions 5 and 20 — every route the ADR names, and the edges. */
export function scopeFollowsThePage(): void {
  const cases: [string, ReturnType<typeof alarmBarScopeOf>][] = [
    ["/", { kind: "all" }],
    ["/alarms", { kind: "all" }],
    ["/control-room", { kind: "all" }],
    [`/control-room/org/${ORG}`, { kind: "organization", organizationId: ORG }],
    [`/control-room/site/${SITE}`, { kind: "location", locationId: SITE }],
    [`/control-room/site/${SITE}/overview`, { kind: "location", locationId: SITE }],
    ["/control-room/site/not-a-uuid/overview", { kind: "all" }],
    ["/control-room/org/abc", { kind: "all" }],
    [`/locations/${SITE}/dashboard`, { kind: "all" }],
  ];
  for (const [path, scope] of cases) {
    expect(alarmBarScopeOf(path), path).toEqual(scope);
  }
}

/** The key differs per scope and is stable for one; the read argument names the one filter. */
export function scopeKeysAndReadArguments(): void {
  const org = { kind: "organization", organizationId: ORG } as const;
  const site = { kind: "location", locationId: SITE } as const;
  expect(new Set([alarmBarScopeKey({ kind: "all" }), alarmBarScopeKey(org), alarmBarScopeKey(site)]).size).toBe(3);
  expect(alarmBarScopeKey(org)).toBe(alarmBarScopeKey({ ...org }));
  expect(alarmReadScopeOf(org)).toEqual({ organizationId: ORG });
  expect(alarmReadScopeOf(site)).toEqual({ locationId: SITE });
  expect(alarmReadScopeOf({ kind: "all" })).toEqual([]);
}

/** Plan Q4 — the list header names the scope; `/control-room` is the Estate. */
export function scopeLabels(): void {
  expect(alarmBarScopeLabel({ kind: "all" }, "/control-room")).toBe("Estate");
  expect(alarmBarScopeLabel({ kind: "all" }, "/alarms")).toBe("All alarms you can read");
  expect(alarmBarScopeLabel({ kind: "organization", organizationId: ORG }, `/control-room/org/${ORG}`)).toBe("This organization");
  expect(alarmBarScopeLabel({ kind: "location", locationId: SITE }, `/control-room/site/${SITE}`)).toBe(
    "This site and its sub-locations",
  );
}

/** Decision 2 — rank first, then the newest; acknowledged alarms are skipped; none is `null`. */
export function newestUnacknowledgedPrefersRankThenTime(): void {
  const olderCritical = alarmItem({ id: "c", severityRank: 30, raisedAt: "2026-11-12T09:00:00.000Z" });
  const newerWarning = alarmItem({ id: "w", severity: "warning", severityRank: 20, raisedAt: "2026-11-12T11:00:00.000Z" });
  const newestCriticalAcked = alarmItem({ id: "k", raisedAt: "2026-11-12T12:00:00.000Z", acknowledgedAt: "2026-11-12T12:01:00.000Z" });
  const newerCritical = alarmItem({ id: "c2", raisedAt: "2026-11-12T10:30:00.000Z" });
  expect(newestUnacknowledged([newerWarning, olderCritical])?.id, "rank over time").toBe("c");
  expect(newestUnacknowledged([olderCritical, newerCritical, newerWarning])?.id, "the newest of the rank").toBe("c2");
  expect(newestUnacknowledged([newestCriticalAcked, newerWarning])?.id, "acknowledged skipped").toBe("w");
  expect(newestUnacknowledged([newestCriticalAcked])).toBeNull();
  expect(newestUnacknowledged([])).toBeNull();
}

/** Decision 2 — counts by rank descending; a rank-25 severity in no seed sorts between 30 and 20. */
export function countsSortByRankDescending(): void {
  const summary: AlarmSummaryResponse = {
    total: 6,
    suppressed: 0,
    items: [
      { code: "info", label: "Info", tone: "info", rank: 10, count: 1, unacknowledged: 1 },
      { code: "warning", label: "Warning", tone: "warning", rank: 20, count: 2, unacknowledged: 2 },
      { code: "urgent", label: "Urgent", tone: "warning", rank: 25, count: 2, unacknowledged: 1 },
      { code: "critical", label: "Critical", tone: "critical", rank: 30, count: 1, unacknowledged: 1 },
    ],
  };
  expect(countsByRankDescending(summary).map((row) => row.code)).toEqual(["critical", "urgent", "warning", "info"]);
  expect(summary.items[0]?.code, "the input is not reordered").toBe("info");
}

/** Decision 17 — the alarm's own location, else the asset's site name. */
export function locationLabelPrefersTheAlarmsOwnLocation(): void {
  expect(alarmLocationLabel({ locationName: "Pump room", siteName: "Site A" })).toBe("Pump room");
  expect(alarmLocationLabel({ locationName: null, siteName: "Site A" })).toBe("Site A");
  expect(alarmLocationLabel({ locationName: null, siteName: null })).toBeNull();
}

/**
 * `F4.357` U6 (decisions 6, 7) — the popup's rows: unacknowledged, rank >= 20, not seen; rank
 * descending, then newest; at most 50.
 */
export function popupRowsFollowRankThenTimeAndSkipSeen(): void {
  const rows = [
    alarmItem({ id: "w-old", severity: "warning", severityRank: 20, raisedAt: "2026-11-12T08:00:00.000Z" }),
    alarmItem({ id: "c-old", raisedAt: "2026-11-12T09:00:00.000Z" }),
    alarmItem({ id: "w-new", severity: "warning", severityRank: 20, raisedAt: "2026-11-12T12:00:00.000Z" }),
    alarmItem({ id: "c-new", raisedAt: "2026-11-12T10:00:00.000Z" }),
    alarmItem({ id: "u", severity: "urgent", severityRank: 25, raisedAt: "2026-11-12T07:00:00.000Z" }),
    alarmItem({ id: "info", severity: "info", severityRank: 10 }),
    alarmItem({ id: "acked", acknowledgedAt: "2026-11-12T10:30:00.000Z" }),
    alarmItem({ id: "seen" }),
  ];
  expect(popupRows(rows, new Set(["seen"])).map((row) => row.id)).toEqual(["c-new", "c-old", "u", "w-new", "w-old"]);
  const many = Array.from({ length: 60 }, (_, i) => alarmItem({ id: `a${i}` }));
  expect(popupRows(many, new Set())).toHaveLength(50);
  expect(popupRows([], new Set())).toEqual([]);
}

/** Q1 — "and N more": the unacknowledged alarms of rank >= 20 beyond the list; never negative. */
export function moreActiveCountIsExactAndNeverNegative(): void {
  const summary = (warning: number, critical: number, info = 4): AlarmSummaryResponse => ({
    total: 0,
    suppressed: 0,
    items: [
      { code: "info", label: "Info", tone: "info", rank: 10, count: info, unacknowledged: info },
      { code: "warning", label: "Warning", tone: "warning", rank: 20, count: warning + 1, unacknowledged: warning },
      { code: "critical", label: "Critical", tone: "critical", rank: 30, count: critical, unacknowledged: critical },
    ],
  });
  const fifty = Array.from({ length: 50 }, (_, i) => alarmItem({ id: `a${i}` }));
  expect(moreActiveCount(summary(10, 50), fifty)).toBe(10);
  expect(moreActiveCount(summary(0, 2), fifty.slice(0, 2))).toBe(0);
  expect(moreActiveCount(summary(0, 1), fifty.slice(0, 3)), "a stale summary never goes negative").toBe(0);
}

/** `F4.357` U7 (decision 9) — the severities that blink: unacknowledged, unseen, rank >= 30. */
export function blinkingSeverityCodesAreUnseenCriticalOnly(): void {
  const list = [
    alarmItem({ id: "c" }),
    alarmItem({ id: "s", severity: "severe", severityRank: 40 }),
    alarmItem({ id: "w", severity: "warning", severityRank: 20 }),
    alarmItem({ id: "k", severity: "acked", acknowledgedAt: "2026-11-12T10:00:00.000Z" }),
    alarmItem({ id: "seen", severity: "seen-sev" }),
  ];
  expect([...blinkingSeverityCodes(list, new Set(["seen"]))].sort()).toEqual(["critical", "severe"]);
  expect(blinkingSeverityCodes([alarmItem({ id: "c" })], new Set(["c"])).size, "a seen alarm stops it").toBe(0);
}
