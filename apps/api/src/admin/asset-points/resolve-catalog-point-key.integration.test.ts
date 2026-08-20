import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { resolveCatalogPointKey } from "./resolve-catalog-point-key";
import { loadFixtures, runResolveCatalogPointKeyTests, type Fixtures } from "./resolve-catalog-point-key.spec";

/**
 * `F1.8`/`F1.9` Phase A — Vitest entry point. Assertions live in the sibling
 * `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F1.8/F1.9",
  label: "catalog point-key resolution tests",
  because:
    "the org-catalog join and the active-flag filter are database behaviours " +
    "carried over unchanged from AssetPointsAdminService's private method; a " +
    "green run without them proves nothing about whether the extraction kept " +
    "that behaviour intact.",
});

describe.skipIf(!connectionString)("resolveCatalogPointKey", () => {
  let pool: pg.Pool | undefined;
  let db: ReturnType<typeof createDb>;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F1.8/F1.9");
    pool = created;
    db = createDb(created);
    fx = await loadFixtures(created);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("resolves a good key, rejects an unknown key, rejects an asset with no organization", async () => {
    await runResolveCatalogPointKeyTests(db, resolveCatalogPointKey, fx);
  });
});
