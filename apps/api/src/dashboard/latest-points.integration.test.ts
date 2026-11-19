import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { inRolledBackTransaction } from "./dashboard-freshness.integration.spec";
import {
  assertLocationDashboardListsReportedKeysOnly,
  assertNoAssetsDiscoverNothingWithoutQuerying,
  assertTheNewReadEqualsTheOldRead,
  cleanup,
  seedLatestFixture,
  type LatestFixture,
} from "./latest-points.integration.spec";

/**
 * `F4.390` — Vitest entry point for the Assets tab latest read against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); this file owns the pool and
 * the committed fixture's lifecycle. The `locationDashboard` case (Task 1.3) writes its own site
 * inside a transaction it rolls back, so it never sees or touches the committed fixture.
 */

const connectionString = requireIntegrationDb({
  item: "F4.390",
  label: "Assets tab latest read",
  because:
    "the discovery from the real-time daily aggregate and the day-literal-bounded lateral are SQL over " +
    "continuous aggregates, so a green run without a database asserts nothing about either.",
});

describe.skipIf(!connectionString)("F4.390 — the Assets tab latest read", () => {
  let pool: pg.Pool | undefined;
  let fixture: LatestFixture | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.390");
    await cleanup(pool);
    fixture = await seedLatestFixture(pool);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fixture);
      await pool.end();
    }
  }, 120_000);

  it("returns exactly the rows of the old unbounded DISTINCT ON read", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheNewReadEqualsTheOldRead(pool);
  });

  it("discovers nothing, without a query, for an empty asset list", async () => {
    await assertNoAssetsDiscoverNothingWithoutQuerying();
  });

  it("locationDashboard lists each asset's reported keys, and none for a silent asset", async (ctx) => {
    if (!pool) throw new Error("pool required");
    await inRolledBackTransaction(pool, (client) =>
      assertLocationDashboardListsReportedKeysOnly(client, (reason) => ctx.skip(reason)),
    );
  }, 60_000);
});
