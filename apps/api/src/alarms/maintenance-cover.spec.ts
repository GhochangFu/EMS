import { expect } from "vitest";

import { type ActiveWindow, type CoverSubject, firstCoveringWindow } from "./maintenance-cover";

/**
 * `F4.359` U6 (ADR 0131 decisions 4, 5 and 9; plan D6, D7) — which active
 * maintenance window, if any, covers an alarm. Pure: the reads that build the
 * windows and the subject are `maintenance-cover.reads.ts`'s. Assertions live
 * here; the sibling `.test.ts` runs them (ADR 0014).
 */

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER_ORG = "bbbbbbbb-0000-4000-8000-00000000000b";
const ASSET = "a0000000-0000-4000-8000-000000000001";
const OTHER_ASSET = "a0000000-0000-4000-8000-000000000002";
const THIRD_ASSET = "a0000000-0000-4000-8000-000000000003";
const RULE = "r0000000-0000-4000-8000-000000000001";
const OTHER_RULE = "r0000000-0000-4000-8000-000000000002";
/** A three-level tree: SITE > BUILDING > ROOM, and a sibling ROOM_B under BUILDING. */
const SITE = "10000000-0000-4000-8000-000000000001";
const BUILDING = "10000000-0000-4000-8000-000000000002";
const ROOM = "10000000-0000-4000-8000-000000000003";
const ROOM_B = "10000000-0000-4000-8000-000000000004";
/** ROOM's ancestor-or-self set, nearest first. */
const ROOM_CHAIN = [ROOM, BUILDING, SITE];

function window(overrides: Partial<ActiveWindow> = {}): ActiveWindow {
  return {
    id: "w0000000-0000-4000-8000-000000000001",
    organizationId: ORG,
    startsAt: new Date("2026-11-13T08:00:00.000Z"),
    assetIds: [],
    locationIds: [],
    ruleIds: [],
    ...overrides,
  };
}

function ruleAlarm(overrides: Partial<Extract<CoverSubject, { source: "rule" }>> = {}): CoverSubject {
  return { source: "rule", organizationId: ORG, assetId: ASSET, ruleId: RULE, locationAncestorIds: ROOM_CHAIN, ...overrides };
}

function rtuAlarm(overrides: Partial<Extract<CoverSubject, { source: "rtu_comms" }>> = {}): CoverSubject {
  return { source: "rtu_comms", organizationId: ORG, locationAncestorIds: ROOM_CHAIN, boundAssetIds: [ASSET, OTHER_ASSET], ...overrides };
}

/** An asset target covers every alarm of the asset. */
export function anAssetTargetCoversTheAssetsAlarm(): void {
  const w = window({ assetIds: [ASSET] });
  expect(firstCoveringWindow([w], ruleAlarm())).toBe(w.id);
  expect(firstCoveringWindow([w], ruleAlarm({ assetId: OTHER_ASSET }))).toBeNull();
}

/** A rule target covers only that rule's alarms — another rule of the same asset is not covered. */
export function aRuleTargetCoversOnlyItsRule(): void {
  const w = window({ ruleIds: [RULE] });
  expect(firstCoveringWindow([w], ruleAlarm())).toBe(w.id);
  expect(firstCoveringWindow([w], ruleAlarm({ ruleId: OTHER_RULE }))).toBeNull();
}

/** A location target covers an asset two levels below it, and an asset at the node itself. */
export function aLocationTargetCoversItsSubtree(): void {
  const w = window({ locationIds: [SITE] });
  expect(firstCoveringWindow([w], ruleAlarm())).toBe(w.id);
  expect(firstCoveringWindow([window({ locationIds: [ROOM] })], ruleAlarm())).toBe(w.id);
}

/** A sibling location is not an ancestor: no cover. */
export function aSiblingLocationDoesNotCover(): void {
  expect(firstCoveringWindow([window({ locationIds: [ROOM_B] })], ruleAlarm())).toBeNull();
}

/** A rule alarm whose rule was deleted (`ruleId` null) is still covered through its asset's location. */
export function aRuleAlarmWithNoRuleIsCoveredByLocation(): void {
  const w = window({ locationIds: [BUILDING], ruleIds: [RULE] });
  expect(firstCoveringWindow([w], ruleAlarm({ ruleId: null }))).toBe(w.id);
  // ...and a rule target alone does not match a null rule.
  expect(firstCoveringWindow([window({ ruleIds: [RULE] })], ruleAlarm({ ruleId: null }))).toBeNull();
}

/** `rtu_comms` (D7): covered by a target location at or above the RTU's location. */
export function anRtuIsCoveredByLocation(): void {
  const w = window({ locationIds: [BUILDING] });
  expect(firstCoveringWindow([w], rtuAlarm())).toBe(w.id);
  expect(firstCoveringWindow([window({ locationIds: [ROOM_B] })], rtuAlarm())).toBeNull();
}

/** `rtu_comms` (D7): covered when every bound asset is an asset target of the same window. */
export function anRtuIsCoveredByAllItsBoundAssets(): void {
  const w = window({ assetIds: [ASSET, OTHER_ASSET, THIRD_ASSET] });
  expect(firstCoveringWindow([w], rtuAlarm())).toBe(w.id);
}

/** One bound asset outside the window keeps the RTU's alarm — `every`, not `some`. */
export function anRtuWithOneBoundAssetOutsideIsNotCovered(): void {
  expect(firstCoveringWindow([window({ assetIds: [ASSET] })], rtuAlarm())).toBeNull();
  // Two windows that each hold half the assets do not add up: "of the same window".
  const halves = [window({ id: "w1", assetIds: [ASSET] }), window({ id: "w2", assetIds: [OTHER_ASSET] })];
  expect(firstCoveringWindow(halves, rtuAlarm())).toBeNull();
}

/** An RTU with no bound asset is never covered by the asset arm (`every` over nothing is not a cover). */
export function anRtuWithNoBoundAssetIsNotCoveredByAssets(): void {
  expect(firstCoveringWindow([window({ assetIds: [ASSET] })], rtuAlarm({ boundAssetIds: [] }))).toBeNull();
}

/** Two covering windows: the earlier start wins, then the smaller id; input order does not matter. */
export function twoWindowsPickTheEarlierStart(): void {
  const early = window({ id: "w-z", startsAt: new Date("2026-11-13T07:00:00.000Z"), assetIds: [ASSET] });
  const late = window({ id: "w-a", startsAt: new Date("2026-11-13T09:00:00.000Z"), assetIds: [ASSET] });
  expect(firstCoveringWindow([late, early], ruleAlarm())).toBe("w-z");
  expect(firstCoveringWindow([early, late], ruleAlarm())).toBe("w-z");
  // A tie on the start falls to the id.
  const tieB = window({ id: "w-b", assetIds: [ASSET] });
  const tieA = window({ id: "w-a", assetIds: [ASSET] });
  expect(firstCoveringWindow([tieB, tieA], ruleAlarm())).toBe("w-a");
  // An earlier window that does not cover is passed over.
  const earlyMiss = window({ id: "w-0", startsAt: new Date("2026-11-13T06:00:00.000Z"), assetIds: [THIRD_ASSET] });
  expect(firstCoveringWindow([late, earlyMiss], ruleAlarm())).toBe("w-a");
}

/** `ingest_host` is never covered, whatever the window targets (decision 5). */
export function anIngestHostAlarmIsNeverCovered(): void {
  const everything = window({ assetIds: [ASSET], locationIds: [SITE], ruleIds: [RULE] });
  expect(firstCoveringWindow([everything], { source: "ingest_host", organizationId: ORG })).toBeNull();
}

/** A window of another organization covers nothing here, even naming the same ids. */
export function anotherOrganizationsWindowNeverCovers(): void {
  const foreign = window({ organizationId: OTHER_ORG, assetIds: [ASSET, OTHER_ASSET], locationIds: [SITE], ruleIds: [RULE] });
  expect(firstCoveringWindow([foreign], ruleAlarm())).toBeNull();
  expect(firstCoveringWindow([foreign], rtuAlarm())).toBeNull();
  expect(firstCoveringWindow([], ruleAlarm())).toBeNull();
}
