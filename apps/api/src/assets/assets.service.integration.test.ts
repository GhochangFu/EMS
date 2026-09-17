import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertListAllComposesAssetIdsAndOrganization,
  assertListAllHidesAForeignOrganizationsRtu,
  assertListAllKeepsUnwiredRowWithNulls,
  assertListAllReportsWiredRowColumns,
  assertListAllScopesByOrganization,
  assertListAllStaysInsideLocationAdminScope,
} from "./assets.service.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";

/**
 * `E2.1` follow-up — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * It has to be an integration suite: the guarantee under test is that a
 * real join to `bms.locations` narrows real seeded rows across the two
 * seeded organizations — a mocked `db` would only prove the mock's own
 * behaviour.
 *
 * `F3.31` (ADR 0068 decision 2) adds a second pool: `AccessControlService`
 * resolves the caller on `bms_auth` (`DATABASE_URL_AUTH`, else derived from the
 * gate's URL as `dashboards.service.rls.integration.test.ts` does) and the
 * gate's own `bms_fleet` pool serves the list read, as in the API.
 */
const connectionString = requireIntegrationDb({
  item: "E2.1 follow-up",
  label: "AssetsService organization scoping tests",
  because:
    "a green run here would assert that GET /api/v1/assets can be narrowed to one " +
    "organization and that the assetIds scope and the organizationId filter compose " +
    "as AND, not OR — while nothing checked either against a real database. Fix the " +
    "pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("E2.1 follow-up — AssetsService organization scoping", () => {
  let pool: pg.Pool;
  let authPool: pg.Pool;
  let db: BmsDb;
  let authDb: BmsDb;

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "E2.1 follow-up");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.31",
    );
    db = createDb(pool);
    authDb = createDb(authPool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (authPool) {
      await authPool.end();
    }
  });

  it("scopes the asset list to one organization, and omitting it returns everything", async () => {
    await assertListAllScopesByOrganization(db);
  });

  it("composes the assetIds scope and the organizationId filter as AND", async () => {
    await assertListAllComposesAssetIdsAndOrganization(db);
  });

  it("F3.31 G1 — every row parses under assetListRowSchema and the wired row matches SQL", async () => {
    await assertListAllReportsWiredRowColumns(pool, db);
  }, 60_000);

  it("F3.31 G1b — an unwired pre-F4.139 row is present and reports nulls", async () => {
    await assertListAllKeepsUnwiredRowWithNulls(pool, db);
  }, 60_000);

  it("F3.31 G2 — a location_admin's rows stay inside its grants after the join", async () => {
    await assertListAllStaysInsideLocationAdminScope(pool, authDb, db);
  }, 60_000);

  it("F3.31 G3 — a mis-stamped rtu_id never names another organization's RTU", async () => {
    await assertListAllHidesAForeignOrganizationsRtu(pool, db);
  }, 60_000);
});
