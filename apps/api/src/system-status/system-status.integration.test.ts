import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertEmptyScopeRunsNoQuery,
  assertAMissingHostMonitorsNothing,
  assertFreshHostWithSilentDevicesIsOk,
  assertNoMqttInScopeIsNotMonitored,
  assertNoRtuIsNotStreaming,
  assertOneFreshOfTwoStreaming,
  assertOutOfScopeFreshMqttIsNotCounted,
  assertRecentlyHeardRtuIsNotOffline,
  assertSixtySecondMqttSampleIsReporting,
  assertStaleHostIsDegraded,
  assertStaleQueueDegradesTheVerdict,
  assertThreeSamplesCountOneFreshAsset,
} from "./system-status.integration.spec";

/**
 * `F3.30` (ADR 0075 decisions 1, 3) — Vitest entry point for the system
 * status read against a real database. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the pool. Every case is
 * rollback-isolated (see the spec). The default `bms_fleet` connection is
 * `BYPASSRLS`, as `FLEET_DRIZZLE` is in production.
 */
const connectionString = requireIntegrationDb({
  item: "F3.30",
  label: "SystemStatusService data quality and field data",
  because:
    "the streaming denominator, the any-point fresh count, the mqtt-only field-data count and the " +
    "scope join are all SQL, so a green run without a database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.30 — GET /system/status read (real database)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.30");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("one fresh mqtt asset of two streaming reads 50 % and operational", async () => {
    await assertOneFreshOfTwoStreaming(db);
  }, 60_000);

  it("an ingest host 31 s past its beat, or with no row, reads field_data degraded (F3.16)", async () => {
    await assertStaleHostIsDegraded(db);
  }, 60_000);

  it("a scope with no mqtt asset reads field_data not_monitored", async () => {
    await assertNoMqttInScopeIsNotMonitored(db);
  }, 60_000);

  it("an asset with no RTU is not streaming", async () => {
    await assertNoRtuIsNotStreaming(db);
  }, 60_000);

  it("an empty scope runs no query", async () => {
    await assertEmptyScopeRunsNoQuery(db);
  }, 60_000);

  it("a stale queue heartbeat degrades the verdict", async () => {
    await assertStaleQueueDegradesTheVerdict(db);
  }, 60_000);

  it("a beating host with every mqtt device silent reads field_data ok and one device offline (F3.16)", async () => {
    await assertFreshHostWithSilentDevicesIsOk(db);
  }, 60_000);

  it("a monitored RTU heard 60 s ago is not offline (F3.16)", async () => {
    await assertRecentlyHeardRtuIsNotOffline(db);
  }, 60_000);

  it("a monitored RTU whose host has no row counts as neither monitored nor offline (F3.16)", async () => {
    await assertAMissingHostMonitorsNothing(db);
  }, 60_000);

  it("a fresh mqtt asset outside the scope reaches neither count", async () => {
    await assertOutOfScopeFreshMqttIsNotCounted(db);
  }, 60_000);

  it("three samples of one asset inside the window count one fresh asset", async () => {
    await assertThreeSamplesCountOneFreshAsset(db);
  }, 60_000);

  it("a 60 s old mqtt sample is inside a 60 s device's 150 s window and reads field_data ok", async () => {
    await assertSixtySecondMqttSampleIsReporting(db);
  }, 60_000);
});
