import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { assertOpenAlarmCountsFollowClearedAt } from "./dashboard.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.10` U12 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pool, on
 * `metric-catalog.integration.test.ts`'s shape. Every row the case needs is
 * inserted inside its own rolled-back transaction, so there is no fixture to
 * build here and nothing to delete in `afterAll`.
 *
 * `max: 1`, for the reason `metric-catalog.integration.test.ts` records: the
 * repo opens many integration pools against one `max_connections`, and the
 * case needs exactly one connection.
 */
const connectionString = requireIntegrationDb({
  item: "F3.10",
  label: "dashboard open-alarm count integration tests",
  because:
    "whether the KPI tiles count an acknowledged, uncleared alarm as open — and leave a cleared, " +
    "unacknowledged one out — is a predicate inside two SQL statements, and a green run without " +
    "a database asserts nothing about either.",
});

describe.skipIf(!connectionString)("F3.10 — dashboard open-alarm counts follow cleared_at", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.10", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  }, 60_000);

  it("counts an acknowledged, uncleared alarm as open and excludes a cleared, unacknowledged one", async () => {
    await assertOpenAlarmCountsFollowClearedAt(pool);
  }, 60_000);
});
