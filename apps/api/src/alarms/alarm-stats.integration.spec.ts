import { expect } from "vitest";

import type { AlarmStats } from "@bms/shared";

import {
  insertAlarm,
  insertAsset,
  insertLocationRow,
  insertOrganization,
  twoSeverities,
  type Pg,
} from "./alarm-list-filters.integration.spec";
import type { AlarmStatsService } from "./alarm-stats.service";

/**
 * `F4.291` PR 2 (ADR 0099 Amendment 9 E5(b)) — `AlarmStatsService.range`
 * against a real database. The fixture is one fresh organization: site `S`
 * with children `L1` and `L2`; asset `A1` in `L1`, `A2` in `L2`, and the
 * OUTSIDER `A3` in `L1` — same organization, same location, alarms in the
 * window, and never in the `assetIds` the claims pass. In the
 * single-organization branch of `withReadScope` Row Level Security bounds a
 * read to the organization only, so each select's own `asset_id = ANY(...)`
 * predicate is the one thing that keeps a location-scoped or asset-group
 * caller's counts inside the ids the tool resolved (the critic's owed
 * verification below the location helper). Every claim asserts exact
 * values the outsider would change, and
 * {@link assertTheOutsiderIsCountedWhenPassed} is the positive neighbour.
 *
 * The window `[from, to)`:
 * - `A1` `high` raised at exactly `from`, acknowledged after 600 s, cleared after 1,800 s;
 * - `A1` `high` raised at from + 2 h, open;
 * - `A2` `low` at from + 3 h, cleared after 1,200 s (no acknowledgement);
 * - `A2` `low` at from + 4 h, cleared after 2,400 s (no acknowledgement);
 * - `A2` `low` at from + 5 h, open;
 * - `A2` `low` raised at exactly `to`, open — outside the half-open window;
 * - `A3` `high` at from + 1 h, acknowledged and cleared after 60 s — the outsider.
 *
 * So for `[A1, A2]`: raised 5, open 2; `high` {2, 1}, `low` {3, 1}; `L2`
 * {3, 1}, `L1` {2, 1}; top assets `A2` 3 then `A1` 2; MTTA 600 s over one
 * acknowledged alarm; MTTR (1,800 + 1,200 + 2,400) / 3 = 1,800 s over three.
 *
 * A second window holds the crowd: 26 children of `S`, one asset and one
 * alarm each, for the 25-row location cut.
 *
 * Vitest entry point: the sibling `.test.ts` (ADR 0014).
 */

export type AlarmStatsFixture = {
  readonly svc: AlarmStatsService;
  readonly organizationId: string;
  readonly l1: string;
  readonly l2: string;
  readonly a1: string;
  readonly a2: string;
  readonly outsider: string;
  readonly high: string;
  readonly low: string;
  readonly from: Date;
  readonly to: Date;
  readonly crowd: { readonly assetIds: readonly string[]; readonly from: Date; readonly to: Date };
};

const at = (base: Date, seconds: number) => new Date(base.getTime() + seconds * 1000);

/** Builds the fixture in a fresh organization; `organizationId` is set first so a failed build is still dropped. */
export async function buildAlarmStatsFixture(
  db: Pg,
  run: string,
  svc: AlarmStatsService,
  created: (organizationId: string) => void,
): Promise<AlarmStatsFixture> {
  const organizationId = await insertOrganization(db, `F4291-S-${run}`);
  created(organizationId);
  const code = (suffix: string) => `F4291-S-${run}-${suffix}`;
  const site = await insertLocationRow(db, { organizationId, code: code("S"), name: "F4.291 site", parentId: null });
  const l1 = await insertLocationRow(db, { organizationId, code: code("L1"), name: "F4.291 L1", parentId: site });
  const l2 = await insertLocationRow(db, { organizationId, code: code("L2"), name: "F4.291 L2", parentId: site });
  const a1 = await insertAsset(db, { organizationId, locationId: l1, code: code("A1"), name: "F4.291 A1" });
  const a2 = await insertAsset(db, { organizationId, locationId: l2, code: code("A2"), name: "F4.291 A2" });
  const outsider = await insertAsset(db, { organizationId, locationId: l1, code: code("A3"), name: "F4.291 A3" });
  const { high, low } = await twoSeverities(db);
  const from = new Date("2026-04-01T00:00:00.000Z");
  const to = new Date("2026-04-04T00:00:00.000Z");
  const alarm = (input: Parameters<typeof insertAlarm>[2]) => insertAlarm(db, organizationId, input);
  await alarm({ assetId: a1, severity: high, raisedAt: from, acknowledgedAt: at(from, 600), clearedAt: at(from, 1800) });
  await alarm({ assetId: a1, severity: high, raisedAt: at(from, 7200) });
  const r3 = at(from, 3 * 3600);
  await alarm({ assetId: a2, severity: low, raisedAt: r3, clearedAt: at(r3, 1200) });
  const r4 = at(from, 4 * 3600);
  await alarm({ assetId: a2, severity: low, raisedAt: r4, clearedAt: at(r4, 2400) });
  await alarm({ assetId: a2, severity: low, raisedAt: at(from, 5 * 3600) });
  await alarm({ assetId: a2, severity: low, raisedAt: to });
  const r7 = at(from, 3600);
  await alarm({ assetId: outsider, severity: high, raisedAt: r7, acknowledgedAt: at(r7, 60), clearedAt: at(r7, 60) });

  const crowdFrom = new Date("2026-05-01T00:00:00.000Z");
  const crowdAssets: string[] = [];
  for (let i = 0; i < 26; i += 1) {
    const n = String(i).padStart(2, "0");
    const location = await insertLocationRow(db, { organizationId, code: code(`C${n}`), name: `F4.291 crowd ${n}`, parentId: site });
    const asset = await insertAsset(db, { organizationId, locationId: location, code: code(`CA${n}`), name: `F4.291 crowd asset ${n}` });
    await alarm({ assetId: asset, severity: low, raisedAt: at(crowdFrom, 60 * (i + 1)) });
    crowdAssets.push(asset);
  }
  return {
    svc,
    organizationId,
    l1,
    l2,
    a1,
    a2,
    outsider,
    high,
    low,
    from,
    to,
    crowd: { assetIds: crowdAssets, from: crowdFrom, to: new Date("2026-05-02T00:00:00.000Z") },
  };
}

const inWindow = (fx: AlarmStatsFixture): Promise<AlarmStats> => fx.svc.range([fx.a1, fx.a2], fx.from, fx.to);

/** The positive neighbour of every exclusion below: passed, the outsider is counted in each section. */
export async function assertTheOutsiderIsCountedWhenPassed(fx: AlarmStatsFixture): Promise<void> {
  const stats = await fx.svc.range([fx.a1, fx.a2, fx.outsider], fx.from, fx.to);
  expect(stats.raised).toBe(6);
  expect(stats.bySeverity.find((row) => row.severity === fx.high)?.raised).toBe(3);
  expect(stats.byLocation.find((row) => row.locationId === fx.l1)?.raised).toBe(3);
  expect(stats.topAssets.map((row) => row.assetId)).toContain(fx.outsider);
  expect(stats.acknowledgedCount).toBe(2);
  expect(stats.clearedCount).toBe(4);
}

/** By severity, inside the half-open window: the alarm at exactly `to` and the outsider are absent. */
export async function assertBySeverityCountsTheWindow(fx: AlarmStatsFixture): Promise<void> {
  const stats = await inWindow(fx);
  expect(stats.bySeverity).toEqual([
    { severity: fx.low, raised: 3, open: 1 },
    { severity: fx.high, raised: 2, open: 1 },
  ]);
  expect([stats.raised, stats.open]).toEqual([5, 2]);
}

/** By location: `L2` {3, 1} then `L1` {2, 1}, named; the outsider in `L1` is not counted. */
export async function assertByLocationCountsTheWindow(fx: AlarmStatsFixture): Promise<void> {
  const stats = await inWindow(fx);
  expect(stats.byLocation).toEqual([
    { locationId: fx.l2, locationName: "F4.291 L2", raised: 3, open: 1 },
    { locationId: fx.l1, locationName: "F4.291 L1", raised: 2, open: 1 },
  ]);
  expect(stats.moreLocations).toBe(false);
}

/** The top assets, by raised count descending: `A2` 3, `A1` 2, and not the outsider. */
export async function assertTopAssetsAreOrderedByRaised(fx: AlarmStatsFixture): Promise<void> {
  const stats = await inWindow(fx);
  expect(stats.topAssets.map((row) => [row.assetId, row.assetCode, row.raised])).toEqual([
    [fx.a2, expect.stringMatching(/-A2$/), 3],
    [fx.a1, expect.stringMatching(/-A1$/), 2],
  ]);
}

/** MTTA is the mean of `acknowledged_at - raised_at` over the one acknowledged alarm: 600 s. */
export async function assertMttaIsTheAcknowledgedMean(fx: AlarmStatsFixture): Promise<void> {
  const stats = await inWindow(fx);
  expect([stats.mttaSeconds, stats.acknowledgedCount]).toEqual([600, 1]);
}

/** MTTR is the mean of `cleared_at - raised_at` over the three cleared alarms: 1,800 s. */
export async function assertMttrIsTheClearedMean(fx: AlarmStatsFixture): Promise<void> {
  const stats = await inWindow(fx);
  expect([stats.mttrSeconds, stats.clearedCount]).toEqual([1800, 3]);
}

/** A window with alarms and no acknowledgement says so with `null`, beside a real count. */
export async function assertNoAcknowledgementIsNull(fx: AlarmStatsFixture): Promise<void> {
  const stats = await fx.svc.range([fx.a2], fx.from, fx.to);
  expect(stats.raised).toBe(3);
  expect(stats.mttaSeconds).toBeNull();
  expect(stats.acknowledgedCount).toBe(0);
}

/** 26 locations with alarms: 25 rows and `moreLocations: true`. */
export async function assertTheLocationsAreCutAt25(fx: AlarmStatsFixture): Promise<void> {
  const stats = await fx.svc.range([...fx.crowd.assetIds], fx.crowd.from, fx.crowd.to);
  expect(stats.raised).toBe(26);
  expect(stats.byLocation).toHaveLength(25);
  expect(stats.moreLocations).toBe(true);
}

/** 25 of 25: every location fits and `moreLocations` is false (the cut's other side). */
export async function assertTwentyFiveLocationsAreNotCut(fx: AlarmStatsFixture): Promise<void> {
  const stats = await fx.svc.range(fx.crowd.assetIds.slice(0, 25), fx.crowd.from, fx.crowd.to);
  expect(stats.byLocation).toHaveLength(25);
  expect(stats.moreLocations).toBe(false);
}
