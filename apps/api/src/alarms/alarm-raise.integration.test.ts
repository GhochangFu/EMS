import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertPreservesSeededSeverity,
  assertRaisesDedupesAndTracesOnlyOnRaise,
} from "./alarm-raise.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.6` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, following
 * `access-control.integration.test.ts`'s shape exactly.
 *
 * It has to be an integration suite: `AlarmRaiser`'s whole reason to exist is
 * `alarms_open_per_rule_uidx`, a database constraint (migration 0032) that
 * replaced a SELECT-then-INSERT race — a unit test with a mocked `db` would
 * re-assert the mock's own behaviour, not the constraint.
 */
const connectionString = requireIntegrationDb({
  item: "F3.6",
  label: "AlarmRaiser integration tests",
  because:
    "a green run here would assert that alarms_open_per_rule_uidx dedupes and " +
    "ADR 0032 severities survive a raise while nothing checked either against a " +
    "real database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.6 — AlarmRaiser against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.6");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("raises once, dedupes a repeat, and traces only on the raise", async () => {
    await assertRaisesDedupesAndTracesOnlyOnRaise(db);
  });

  it("preserves a severity added to the vocabulary by a plain INSERT", async () => {
    await assertPreservesSeededSeverity(db);
  });
});
