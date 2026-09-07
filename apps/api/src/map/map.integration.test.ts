import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { assertSiteOpenAlarmsFollowClearedAt } from "./map.integration.spec";
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
});
