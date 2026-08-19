import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { assertRaisesUnscopedButReturnsScoped } from "./evaluate-enabled-rules.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.6` task 5 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * Integration, not unit: the guarantee is that `evaluateEnabledRules` raises
 * through `AlarmRaiser` regardless of the caller's `assetIds`, which touches
 * `bms.alarms`, `bms.automation_rules` and `bms.rule_executions` together —
 * exactly the kind of cross-table behaviour a mocked `db` would only prove
 * against itself.
 */
const connectionString = requireIntegrationDb({
  item: "F3.6",
  label: "evaluateEnabledRules scope tests",
  because:
    "a green run here would assert that the on-demand evaluator raises unscoped " +
    "(ADR 0033 decision 2) while nothing checked it against a real database. Fix " +
    "the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.6 — evaluateEnabledRules against a real database", () => {
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

  // 30s, not the 5s default: ADR 0033 decision 2 makes this evaluate every
  // enabled+published rule regardless of the caller's assetIds — 337 on the
  // seeded dev database as of F3.6 (migration 0033 alone added 249) — each a
  // handful of sequential round trips. Real, not a flake; see the F3.6 note
  // on evaluateEnabledRules' latency in docs/BACKLOG.md.
  it(
    "raises for every matched rule, but returns traces only for the caller's assetIds",
    async () => {
      await assertRaisesUnscopedButReturnsScoped(db);
    },
    30_000,
  );
});
