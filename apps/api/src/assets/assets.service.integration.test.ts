import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import {
  assertListAllComposesAssetIdsAndOrganization,
  assertListAllScopesByOrganization,
} from "./assets.service.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `E2.1` follow-up — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * It has to be an integration suite: the guarantee under test is that a
 * real join to `bms.locations` narrows real seeded rows across the two
 * seeded organizations — a mocked `db` would only prove the mock's own
 * behaviour.
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
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E2.1 follow-up");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("scopes the asset list to one organization, and omitting it returns everything", async () => {
    await assertListAllScopesByOrganization(db);
  });

  it("composes the assetIds scope and the organizationId filter as AND", async () => {
    await assertListAllComposesAssetIdsAndOrganization(db);
  });
});
