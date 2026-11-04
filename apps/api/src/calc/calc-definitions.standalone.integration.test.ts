import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import {
  assertANoFormulaRowIsACountedSkip,
  assertAPinnedAssetsOverrideIsReadOnce,
  assertTheStandaloneDefinitionIsLoaded,
  assertTheTemplateDefinitionIsLoaded,
  cleanup,
  DERIVED_KEY,
  NO_FORMULA_KEY,
  STANDALONE_KEY,
} from "./calc-definitions.standalone.integration.spec";

/**
 * `F4.311` PR 1 — Vitest entry point for the loader's two reads (ADR 0109
 * decision 2). Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "calc loader two-source tests",
  because:
    "the standalone read is SQL that no unit test issues: every calc unit test builds " +
    "its definitions by hand, so dropping either read is invisible without a database.",
});

describe.skipIf(!connectionString)("F4.311 — the calc loader reads two sources", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.311");
    pool = created;
    releasePointKeys = await registerFixturePointKeys(created, [STANDALONE_KEY, NO_FORMULA_KEY, DERIVED_KEY]);
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("holds the template-derived definition", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheTemplateDefinitionIsLoaded(pool, fx);
  });

  it("holds the standalone definition, keyed on its asset_points row", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheStandaloneDefinitionIsLoaded(pool, fx);
  });

  it("counts a standalone row with no formula as a no_formula skip", async () => {
    if (!pool) throw new Error("pool required");
    await assertANoFormulaRowIsACountedSkip(pool, fx);
  });

  it("reads a pinned asset's override once, through the merge only", async () => {
    if (!pool) throw new Error("pool required");
    await assertAPinnedAssetsOverrideIsReadOnce(pool, fx);
  });
});
