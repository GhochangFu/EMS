import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertClearedAlarmDoesNotCount,
  assertEmptyScopeIsEmptyItems,
  assertForeignAssetIsDropped,
  assertNoRoleAssetIsAbsent,
  assertOfflineCountIsOne,
  assertOnlyHeldRolesInSortOrder,
  assertResponseMatchesTheContract,
  assertRetiredRoleIsIncluded,
  assertSameRoleInTwoGroupsCountsOnce,
  assertTwoRolesCountUnderEach,
  assertWorstCountIsAssetsAtTheWorst,
  assertWorstIsByRank,
} from "./asset-role-summary.integration.spec";

/**
 * `F3.28` (ADR 0074, plan task 3.2) — Vitest entry point for the per-role
 * asset summary. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the pool. Every case is rollback-isolated (see the spec).
 */
const connectionString = requireIntegrationDb({
  item: "F3.28",
  label: "AssetRoleSummaryService per-role counts",
  because:
    "a green run here would assert that the class strip's per-role counts dedupe memberships, rank the " +
    "worst active severity, ignore cleared alarms, count offline assets against the 25 s bound and drop " +
    "a foreign organization's asset — while nothing checked the SQL against a real database.",
});

describe.skipIf(!connectionString)("F3.28 — GET /assets/role-summary counts (real database)", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.28");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("the same role in two groups counts once", async () => {
    await assertSameRoleInTwoGroupsCountsOnce(db);
  }, 60_000);

  it("an asset with two roles counts under each", async () => {
    await assertTwoRolesCountUnderEach(db);
  }, 60_000);

  it("the worst severity is the highest rank", async () => {
    await assertWorstIsByRank(db);
  }, 60_000);

  it("worstCount counts only the assets at the worst severity", async () => {
    await assertWorstCountIsAssetsAtTheWorst(db);
  }, 60_000);

  it("a cleared alarm does not count", async () => {
    await assertClearedAlarmDoesNotCount(db);
  }, 60_000);

  it("offlineCount is 1 for a sample 27 s old", async () => {
    await assertOfflineCountIsOne(db);
  }, 60_000);

  it("a retired role an asset still holds is included", async () => {
    await assertRetiredRoleIsIncluded(db);
  }, 60_000);

  it("returns exactly the held roles, in sort_order", async () => {
    await assertOnlyHeldRolesInSortOrder(db);
  }, 60_000);

  it("a role-less asset is counted nowhere", async () => {
    await assertNoRoleAssetIsAbsent(db);
  }, 60_000);

  it("a requested foreign asset is dropped", async () => {
    await assertForeignAssetIsDropped(db);
  }, 60_000);

  it("an empty scope answers items: []", async () => {
    await assertEmptyScopeIsEmptyItems(db);
  }, 60_000);

  it("the response matches the shared contract", async () => {
    await assertResponseMatchesTheContract(db);
  }, 60_000);
});
