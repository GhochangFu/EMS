import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { assertADeviceAlarmEscalatesOnceAndClearsAfterTheHold } from "./alarm-lifecycle-device.integration.spec";

/**
 * `F3.16` (plan B4) — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the pool, `alarm-lifecycle.integration.test.ts`'s shape.
 */
const connectionString = requireIntegrationDb({
  item: "F3.16",
  label: "the lifecycle sweep over device alarms (clear hold, stale host, escalation ledger)",
  because:
    "the device-alarm selection, the monitored-RTU and host reads, the left-joined clear read-back " +
    "and the ledger that answers a device escalation step under its system key are all SQL; a " +
    "green run without a database asserts none of them.",
});

describe.skipIf(!connectionString)("F3.16 — the lifecycle sweep over a device alarm against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.16");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("escalates a device step once under the system key, sends nothing with no profile, holds through a stale host and clears 120 s after the RTU returns", async () => {
    await assertADeviceAlarmEscalatesOnceAndClearsAfterTheHold(db);
  }, 60_000);
});
