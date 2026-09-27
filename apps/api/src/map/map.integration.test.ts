import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertCommStatusCountsNonKwFresh,
  assertCommStatusLeavesAStaleAssetOut,
  assertJoinedPinKindIsTheLocationType,
  assertJoinedPinKindLabelIsTheLookupLabel,
  assertJoinedPumpStationPinCountsItsAssets,
  assertJoinedPumpStationPinCountsItsCriticalAlarm,
  assertJoinedPumpStationPinOfPumpStationKindCountsItsAssets,
  assertNoF4157MapFixtureRowsRemain,
  assertSiteOpenAlarmsFollowClearedAt,
  assertUnjoinedStationPinKindLabelIsStation,
  assertUnjoinedStationPinStatusIsItsOperatingStatus,
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
