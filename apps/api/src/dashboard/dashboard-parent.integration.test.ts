import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertALocationGrantHidesAnUnreadableParent,
  assertGlobalScopeNamesEachChildsParent,
  assertNoMapIsNullEverywhere,
  assertSitesTotalSkipsAnAssetlessParent,
  assertTheLocationDashboardNamesTheParent,
} from "./dashboard-parent.integration.spec";
import { inRolledBackTransaction } from "./dashboard-freshness.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F4.240` — Vitest entry point for `parentId` on the location KPI item (ADR 0139 decision 12).
 * Assertions live in the sibling `.spec` (§4.6); every case rolls its own transaction back.
 * The superuser connection is the spec's docblock's reason: P2 inserts a `bms.users` row.
 */
const connectionString = requireIntegrationDb({
  item: "F4.240",
  label: "location KPI parentId integration tests",
  because:
    "whether an unreadable parent's id reaches the wire depends on the scope scopeFromSource reads " +
    "from the database, and a green run without one asserts nothing about it.",
  connection: "superuser",
});

describe.skipIf(!connectionString)("F4.240 — the location KPI item names its readable parent (ADR 0139 decision 12)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.240", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () => inRolledBackTransaction(pool, fn);

  it("P1 — global scope: each child names the parent; the parent is a root", run(assertGlobalScopeNamesEachChildsParent), 60_000);
  it("P2 — a grant on one child: parentId is null and the parent's id is not on the wire", run(assertALocationGrantHidesAnUnreadableParent), 60_000);
  it("P3 — locationDashboard(child) names the parent", run(assertTheLocationDashboardNamesTheParent), 60_000);
  it("P4 — no map: every parentId is null (fail closed)", run(assertNoMapIsNullEverywhere), 60_000);
  it("P5 — sitesTotal over two children's assets is 2, not 3 (decision 16 pin)", run(assertSitesTotalSkipsAnAssetlessParent), 60_000);
});
