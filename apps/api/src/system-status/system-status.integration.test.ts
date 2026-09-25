import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertEmptyScopeRunsNoQuery,
  assertFreshSimulatorDoesNotMakeFieldDataOk,
  assertNoMqttInScopeIsNotMonitored,
  assertNoRtuIsNotStreaming,
  assertOneFreshOfTwoStreaming,
  assertOutOfScopeFreshMqttIsNotCounted,
  assertSixtySecondMqttSampleIsReporting,
  assertStaleMqttIsDegraded,
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

  it("a 200 s old mqtt sample, beyond the 150 s reporting window, reads field_data degraded", async () => {
    await assertStaleMqttIsDegraded(db);
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

  it("a fresh simulator asset beside a silent mqtt asset reads field_data degraded at 50 %", async () => {
    await assertFreshSimulatorDoesNotMakeFieldDataOk(db);
  }, 60_000);

  it("a fresh mqtt asset outside the scope reaches neither count", async () => {
    await assertOutOfScopeFreshMqttIsNotCounted(db);
  }, 60_000);

  it("three samples of one asset inside the window count one fresh asset", async () => {
    await assertThreeSamplesCountOneFreshAsset(db);
  }, 60_000);

  it("a 60 s old mqtt sample is inside the 150 s reporting window and reads field_data ok", async () => {
    await assertSixtySecondMqttSampleIsReporting(db);
  }, 60_000);
});
