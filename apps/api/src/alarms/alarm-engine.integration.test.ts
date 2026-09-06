import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { assertStreamingRaiseDispatchesOnce } from "./alarm-engine.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.7` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle, following
 * `alarm-raise.integration.test.ts`'s shape exactly.
 *
 * Integration, not unit: what it proves is that the widened cache `SELECT`
 * carries `automation_rules.action` from a real row into the dispatch, and
 * that the second batch is refused by `alarms_open_per_rule_uidx` (migration
 * 0032) rather than by anything this test arranged. A mocked `db` would assert
 * both against itself.
 */
const connectionString = requireIntegrationDb({
  item: "F3.7",
  label: "AlarmEngineService streaming dispatch tests",
  because:
    "a green run here would assert that the streaming engine reads a rule's stored " +
    "action and dispatches once per transition while nothing checked either against " +
    "a real database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.7 — AlarmEngineService against a real database", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.7");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  // 30s, not the 5s default: the cache read loads every enabled + published
  // threshold rule in the database (289 on the seeded dev database as of
  // 2026-09-06), and two batches are evaluated, each with its own raise and a
  // polled fire-and-forget dispatch. The siblings in this directory take the
  // same budget for the same reason.
  it(
    "dispatches once when the alarm opens, and nothing when the same reading is re-observed",
    async () => {
      await assertStreamingRaiseDispatchesOnce(db);
    },
    30_000,
  );
});
