import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertClearsAfterTheHoldAndReopens,
  assertEscalatesOnceAndTellsSentChannelsOnly,
  assertTwoBandsClearOnOneSample,
} from "./alarm-lifecycle.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.10` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, following
 * `alarm-raise.integration.test.ts`'s shape exactly.
 *
 * It has to be an integration suite: the sweep's selection, the
 * `cleared_at IS NULL` guard, the `0066` index predicate, the escalation
 * join and the ledger reads inside the notification path are all SQL, and a
 * unit test with a mocked `db` would re-assert the mock's own behaviour.
 */
const connectionString = requireIntegrationDb({
  item: "F3.10",
  label: "alarm lifecycle sweep integration tests",
  because:
    "a green run here would assert that an alarm clears after its hold and re-raises only once " +
    "cleared, that an escalation step is sent once and stops on acknowledgement, and that the " +
    "cleared message reaches only the channels holding a sent row — while nothing checked any " +
    "of it against a real database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.10 — alarm lifecycle sweep against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.10");
    db = createDb(pool);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("clears after the hold from fresh samples only, broadcasts once, and lets the condition re-raise", async () => {
    await assertClearsAfterTheHoldAndReopens(db);
  }, 60_000);

  it("escalates a due step once, stops on acknowledgement, and tells only the channels holding a sent row on clear", async () => {
    await assertEscalatesOnceAndTellsSentChannelsOnly(db);
  }, 60_000);

  it("clears both bands on one asset from one reading, each on its own hold", async () => {
    await assertTwoBandsClearOnOneSample(db);
  }, 60_000);
});
