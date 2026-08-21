import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertCacheIsNotReReadWithinTtl,
  assertHandCreatedAssetContributesNothing,
  assertLoaderResolvesValidRowsAndSkipsInvalidOnes,
  cleanup,
} from "./calc-definitions.integration.spec";

/**
 * `F2.4` — Vitest entry point for `CalcDefinitionsService`. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "F2.4",
  label: "calc definition loader tests",
  because:
    "the asset -> assets.templateId -> template_points join, the derived-row skip " +
    "classification, and the 60s cache are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("F2.4 — calc definition loader", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.4");
    pool = created;
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  // Each case seeds its own template + asset at (org, TEST_TEMPLATE_CODE,
  // version 1) — asset_templates_org_code_version_unique means a prior
  // case's row must be gone first.
  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("resolves valid derived rows and skips a null calc_trigger, regardless of a valid formula", async () => {
    if (!pool) throw new Error("pool required");
    await assertLoaderResolvesValidRowsAndSkipsInvalidOnes(pool, fx);
  });

  it("never resolves a hand-created asset (templateId: null) to a calc definition", async () => {
    if (!pool) throw new Error("pool required");
    await assertHandCreatedAssetContributesNothing(pool, fx);
  });

  it("does not re-read within its 60s cache TTL", async () => {
    if (!pool) throw new Error("pool required");
    await assertCacheIsNotReReadWithinTtl(pool, fx);
  });
});
