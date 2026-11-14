import { expect } from "vitest";

import {
  alarmListQuery,
  criticalMayReadAllClear,
  isAlarmListFiltered,
  readAlarmPageFilter,
  writeAlarmPageFilter,
} from "./alarm-page-filter";

/**
 * `F4.361` U7 (ADR 0132 decisions 3, 7 and 9; plan D15) — the `/alarms` page's own two filters,
 * Severity and State, and how they join the scope filter into one list request.
 * `alarm-page-filter.test.ts` is the Vitest entry point.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSET = "44444444-4444-4444-8444-444444444444";

/** State is `active` or `suppressed`; anything else (`all`, `unacknowledged`, junk) reads as All (decision 7). */
export function readsStateAndSeverity(): void {
  expect(readAlarmPageFilter(new URLSearchParams("state=suppressed&severity=%20critical%20"))).toEqual({
    state: "suppressed",
    severity: "critical",
  });
  expect(readAlarmPageFilter(new URLSearchParams("state=active"))).toEqual({ state: "active" });
  expect(readAlarmPageFilter(new URLSearchParams("state=unacknowledged&severity="))).toEqual({});
  expect(readAlarmPageFilter(new URLSearchParams("state=all"))).toEqual({});
}

/** Writing replaces the two keys and keeps the scope keys. */
export function writeKeepsTheScope(): void {
  const params = new URLSearchParams(`organizationId=${ORG}&state=active`);
  const next = writeAlarmPageFilter(params, { severity: "warning" });
  expect(next.get("organizationId")).toBe(ORG);
  expect(next.get("severity")).toBe("warning");
  expect(next.has("state")).toBe(false);
}

/** The request is the scope plus the page's two keys; a key left out is not present at all. */
export function theQueryJoinsScopeAndPage(): void {
  expect(alarmListQuery({ organizationId: ORG, assetId: ASSET }, { state: "suppressed", severity: "critical" })).toEqual({
    organizationId: ORG,
    assetId: ASSET,
    state: "suppressed",
    severity: "critical",
  });
  expect(Object.keys(alarmListQuery({}, {}))).toEqual([]);
}

/** Critical says "all clear" only with no severity chosen and State not Suppressed (D15). */
export function allClearOnlyUnfilteredBySeverityOrSuppressed(): void {
  expect(criticalMayReadAllClear({})).toBe(true);
  expect(criticalMayReadAllClear({ state: "active" })).toBe(true);
  expect(criticalMayReadAllClear({ state: "suppressed" })).toBe(false);
  expect(criticalMayReadAllClear({ severity: "warning" })).toBe(false);
}

/** Any scope id, severity or state makes an empty list a filtered one. */
export function filteredMeansAnyKey(): void {
  expect(isAlarmListFiltered({})).toBe(false);
  expect(isAlarmListFiltered({ organizationId: ORG })).toBe(true);
  expect(isAlarmListFiltered({ severity: "critical" })).toBe(true);
  expect(isAlarmListFiltered({ state: "active" })).toBe(true);
}
