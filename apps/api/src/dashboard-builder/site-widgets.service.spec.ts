import { expect } from "vitest";

import { readableGroupIds, tabOf, type CandidateGroup, type TabStatusRow } from "./site-widgets.service";

/**
 * `F3.73` (plan D9, Task 3.4) — the site-widgets read's two pure helpers. Assertions live here;
 * `site-widgets.service.test.ts` is the Vitest entry point (ADR 0014). The SQL is proved in
 * `site-widgets.service.integration.spec.ts`.
 */

const G1 = "10000000-0000-4000-8000-000000000001";
const G2 = "10000000-0000-4000-8000-000000000002";
const G3 = "10000000-0000-4000-8000-000000000003";
const L1 = "20000000-0000-4000-8000-000000000001";
const L2 = "20000000-0000-4000-8000-000000000002";

const CANDIDATES: readonly CandidateGroup[] = [
  { id: G1, locationId: L1 },
  { id: G2, locationId: L1 },
  { id: G3, locationId: L2 },
];

/** An unrestricted reader keeps every candidate. */
export function unrestrictedKeepsEveryGroup(): void {
  expect(readableGroupIds(CANDIDATES, null)).toEqual([G1, G2, G3]);
}

/** An asset-group grant keeps the granted candidates only; a granted id that is no candidate adds nothing. */
export function groupGrantKeepsTheGrantedGroups(): void {
  expect(readableGroupIds(CANDIDATES, { groupIds: [G2, "10000000-0000-4000-8000-00000000000f"] })).toEqual([G2]);
}

/** A location grant keeps the candidates sited at a readable location. */
export function locationGrantKeepsTheGroupsAtReadableSites(): void {
  expect(readableGroupIds(CANDIDATES, { locationIds: [L1] })).toEqual([G1, G2]);
}

/** An empty grant keeps nothing — the summary then answers `{ items: [] }` without a query. */
export function emptyGrantKeepsNothing(): void {
  expect(readableGroupIds(CANDIDATES, { groupIds: [] })).toEqual([]);
}

function row(overrides: Partial<TabStatusRow>): TabStatusRow {
  return {
    tab_key: "b",
    label: "Tab b",
    asset_group_id: G1,
    member_total: 2,
    assets: 2,
    active_alarms: 1,
    offline_assets: 1,
    worst_severity: "critical",
    worst_tone: "critical",
    ...overrides,
  };
}

/** A group with members, none readable, is "Outside scope": `status: null`, never zeros. */
export function noReadableMemberIsNullStatus(): void {
  expect(tabOf(row({ member_total: 2, assets: 0 })).status).toBeNull();
}

/** A group with no member at all has a zero status, not "Outside scope". */
export function emptyGroupIsAZeroStatus(): void {
  expect(
    tabOf(row({ member_total: 0, assets: 0, active_alarms: 0, offline_assets: 0, worst_severity: null, worst_tone: null }))
      .status,
  ).toEqual({ worstSeverity: null, tone: "ok", activeAlarms: 0, offlineAssets: 0, assets: 0 });
}

/** The worst severity's own vocabulary tone is carried through. */
export function worstSeverityCarriesItsTone(): void {
  expect(tabOf(row({})).status).toEqual({
    worstSeverity: "critical",
    tone: "critical",
    activeAlarms: 1,
    offlineAssets: 1,
    assets: 2,
  });
}
