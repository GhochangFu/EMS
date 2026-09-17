import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { assertListAllHidesAForeignOrganizationsRtu } from "./assets.service.rtu-organization.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";

/**
 * `F3.31` G3 — Vitest entry point. The assertion lives in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle. Its own suite
 * because it is rollback-isolated and `tests/integration-fixture-isolation`
 * keeps such a spec apart from one that reads the seed (see the spec).
 */
const connectionString = requireIntegrationDb({
  item: "F3.31",
  label: "AssetsService rtus join organization predicate",
  because:
    "a green run here would assert that a mis-stamped rtu_id never names another " +
    "organization's RTU through GET /api/v1/assets — while nothing checked it against " +
    "a real database. Fix the pipeline, do not relax this guard.",
});

describe.skipIf(!connectionString)("F3.31 — the rtus join carries the organization predicate", () => {
  let pool: pg.Pool;
  let db: BmsDb;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.31");
    db = createDb(pool);
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("G3 — a mis-stamped rtu_id never names another organization's RTU", async () => {
    await assertListAllHidesAForeignOrganizationsRtu(db);
  }, 60_000);
});
