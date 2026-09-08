import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAFailedRaiseIsDeliveredByALaterSweepOnce,
  assertASentRaiseIsNeverReoffered,
  assertTheCeilingDoesNotBurnTheRetry,
} from "./alarm-lifecycle-raise-retry.integration.spec";

/**
 * `F3.51` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, following
 * `alarm-lifecycle.integration.test.ts`'s shape.
 *
 * A separate suite from that one because
 * `alarm-lifecycle.integration.spec.ts` stood at 978 of AGENTS.md §4.5's
 * 1000-line cap with these three scenarios in it. It exports its harness and
 * fixture helpers, which this file drives.
 */
const connectionString = requireIntegrationDb({
  item: "F3.51",
  label: "alarm lifecycle raise-retry integration tests",
  because:
    "a green run here would assert that an undelivered raise is re-offered once and only to the " +
    "channels the ledger still owes it, that a permanently refusing hourly ceiling writes no row " +
    "and burns no attempt, and that a delivered raise is never re-offered — while nothing " +
    "checked any of it against a real ledger, a real rule_notifications join or the real " +
    "wall-clock rate limit. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.51 — the raise-retry phase against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.51");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("delivers a failed raise on a later sweep, once, under the original key, and not to a channel with no evidence", async () => {
    await assertAFailedRaiseIsDeliveredByALaterSweepOnce(db);
  }, 60_000);

  it("writes no row while the hourly ceiling refuses a re-offered raise, and still delivers once it lifts", async () => {
    await assertTheCeilingDoesNotBurnTheRetry(db);
  }, 60_000);

  it("never re-offers a raise a channel already holds a sent row for, while the channel that failed is retried", async () => {
    await assertASentRaiseIsNeverReoffered(db);
  }, 60_000);
});
