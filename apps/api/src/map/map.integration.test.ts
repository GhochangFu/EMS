import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertAnUnpinnedActiveLocationIsAPin,
  assertAnUnpinnedInactiveLocationIsNotAPin,
  assertAPinnedLocationIsListedOnce,
  assertCommStatusCountsNonKwFresh,
  assertCommStatusLeavesAStaleAssetOut,
  assertJoinedPinKindIsTheLocationType,
  assertJoinedPinKindLabelIsTheLookupLabel,
  assertJoinedPumpStationPinCountsItsAssets,
  assertJoinedPumpStationPinCountsItsCriticalAlarm,
  assertJoinedPumpStationPinOfPumpStationKindCountsItsAssets,
  assertNoF379MapFixtureRowsRemain,
  assertNoF4157MapFixtureRowsRemain,
  assertSiteOpenAlarmsFollowClearedAt,
  assertTheScopeFilterKeepsTheNewPinById,
  assertASameNamedLocationOfAnotherOrganizationIsNotSeen,
  assertAnUnjoinedPinIsStillScopedByName,
  assertUnjoinedStationPinKindLabelIsStation,
  assertUnjoinedStationPinStatusIsItsOperatingStatus,
  assertAnInteriorNodeHoldingAnActiveAssetIsAPin,
  assertAnInteriorNodeWithNoAssetIsNotAPin,
  assertAParentWhoseOnlyChildIsInactiveIsAPin,
  assertAScopedCallerWithAnUnreadableAncestorSeesNothing,
  assertAScopedCallerWithAnUnreadableParentSeesNothing,
  assertNoF210MapFixtureRowsRemain,
  assertTheParentFilterDropsUnjoinedStationPins,
  assertTheParentFilterKeepsOnlyTheSubtreesPins,
  assertTheSeededArmFollowsThePinRule,
} from "./map.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.10` U12 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pool, on
 * `metric-catalog.integration.test.ts`'s shape. The case inserts every row it
 * needs inside its own rolled-back transaction, so there is no fixture here
 * and nothing to delete in `afterAll`. `max: 1` for the reason that file
 * records.
 */
const connectionString = requireIntegrationDb({
  item: "F3.10",
  label: "map site open-alarm count integration tests",
  because:
    "whether a map site counts an acknowledged, uncleared alarm as open — and leaves a cleared, " +
    "unacknowledged one out — is a predicate inside sitesLive's SQL, and a green run without a " +
    "database asserts nothing about it.",
});

describe.skipIf(!connectionString)("F3.10 — map site open-alarm counts follow cleared_at", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.10", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("counts an acknowledged, uncleared alarm for its site and excludes a cleared, unacknowledged one", async () => {
    await assertSiteOpenAlarmsFollowClearedAt(pool);
  }, 60_000);

  it("counts a non-kw sample as fresh in the comm-status any-point rule (F3.30, ADR 0075 decision 2)", async () => {
    await assertCommStatusCountsNonKwFresh(pool);
  }, 60_000);

  it("counts a 60 s sample in assetsTotal and not in assetsFresh (F3.30 code review 3)", async () => {
    await assertCommStatusLeavesAStaleAssetOut(pool);
  }, 60_000);
});

describe.skipIf(!connectionString)("F4.157 — the map reads the location type and label", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.157", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("M1a: a joined pin's kind is the location's type, not the pin's rsmoc", async () => {
    await assertJoinedPinKindIsTheLocationType(pool);
  }, 60_000);

  it("M1b: a joined pin's kindLabel is the bms.location_types label", async () => {
    await assertJoinedPinKindLabelIsTheLookupLabel(pool);
  }, 60_000);

  it("M2a: a joined pump_station pin counts its location's assets", async () => {
    await assertJoinedPumpStationPinCountsItsAssets(pool);
  }, 60_000);

  it("M2b: a joined pump_station pin counts its location's open critical alarm", async () => {
    await assertJoinedPumpStationPinCountsItsCriticalAlarm(pool);
  }, 60_000);

  it("M2c: a joined pin that itself says pump_station carries live health", async () => {
    await assertJoinedPumpStationPinOfPumpStationKindCountsItsAssets(pool);
  }, 60_000);

  it("M3a: an eskom_station pin with no location reads Station", async () => {
    await assertUnjoinedStationPinKindLabelIsStation(pool);
  }, 60_000);

  it("M3b: an eskom_station pin with no location takes its status from station_operating_status", async () => {
    await assertUnjoinedStationPinStatusIsItsOperatingStatus(pool);
  }, 60_000);

  it("leaves no F4157M fixture row behind (counted as bms_fleet)", async () => {
    await assertNoF4157MapFixtureRowsRemain(pool);
  }, 60_000);
});

describe.skipIf(!connectionString)("F3.79 — every active location is a map pin", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.79", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("I1: an active location with no map_locations row is a pin, from its own columns", async () => {
    await assertAnUnpinnedActiveLocationIsAPin(pool);
  }, 60_000);

  it("I2: an inactive location with no map_locations row is not a pin", async () => {
    await assertAnUnpinnedInactiveLocationIsNotAPin(pool);
  }, 60_000);

  it("I3: a location with a map_locations row is listed once", async () => {
    await assertAPinnedLocationIsListedOnce(pool);
  }, 60_000);

  it("I4: the scope filter keeps the new pin by the location id", async () => {
    await assertTheScopeFilterKeepsTheNewPinById(pool);
  }, 60_000);

  it("I5: a same-named location of another organization is not seen (security review)", async () => {
    await assertASameNamedLocationOfAnotherOrganizationIsNotSeen(pool);
  }, 60_000);

  it("I6: a pin that joins no location is still scoped by its site_name", async () => {
    await assertAnUnjoinedPinIsStillScopedByName(pool);
  }, 60_000);

  it("leaves no F379M fixture row behind (counted as bms_fleet)", async () => {
    await assertNoF379MapFixtureRowsRemain(pool);
  }, 60_000);

  // F2.10 — ADR 0098 decision 11, B4, B12.
  it("P1: an interior node with no asset is not a pin (arm 2)", async () => {
    await assertAnInteriorNodeWithNoAssetIsNotAPin(pool);
  }, 60_000);

  it("P2: an interior node holding an active asset is a pin", async () => {
    await assertAnInteriorNodeHoldingAnActiveAssetIsAPin(pool);
  }, 60_000);

  it("P3: a parent whose only child is inactive is a pin", async () => {
    await assertAParentWhoseOnlyChildIsInactiveIsAPin(pool);
  }, 60_000);

  it("P4: the map_locations arm follows the pin rule; an unjoined row stays", async () => {
    await assertTheSeededArmFollowsThePinRule(pool);
  }, 60_000);

  it("P5: parentLocationId keeps exactly the subtree's pins", async () => {
    await assertTheParentFilterKeepsOnlyTheSubtreesPins(pool);
  }, 60_000);

  it("P6: parentLocationId drops unjoined station pins (B4)", async () => {
    await assertTheParentFilterDropsUnjoinedStationPins(pool);
  }, 60_000);

  it("P7: a scoped caller with an unreadable parent sees nothing", async () => {
    await assertAScopedCallerWithAnUnreadableParentSeesNothing(pool);
  }, 60_000);

  it("P8: a scoped caller with an unreadable ancestor of a readable node sees nothing", async () => {
    await assertAScopedCallerWithAnUnreadableAncestorSeesNothing(pool);
  }, 60_000);

  it("leaves no F210M fixture row behind (counted as bms_fleet)", async () => {
    await assertNoF210MapFixtureRowsRemain(pool);
  }, 60_000);
});
