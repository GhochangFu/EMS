import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import {
  assertAllNullRowIsIdenticalToNoRow,
  assertEachAssetResolvesAgainstItsOwnPin,
  assertEachColumnOverridesIndependently,
  assertFullOverrideTakesNothingFromTemplate,
  assertInactiveRowStillResolves,
  assertMeasuredPointIsNeverActivatedByAnOverride,
  assertNonComputedRowOverridesNothing,
  assertNoRowInheritsEverything,
  assertOverrideDoesNotLeakBetweenAssets,
  cleanup,
} from "./calc-definitions.merge.integration.spec";

/**
 * `F2.6` U3 — Vitest entry point for the resolution merge. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.6",
  label: "calc resolution merge tests",
  because:
    "coalesce(asset_points.<col>, template_points.<col>) is SQL, and it is the one " +
    "change in F2.6 that computes a wrong number instead of failing. Every unit test " +
    "in apps/api/src/calc/ constructs CalcDefinitionsService's dependencies directly " +
    "and never issues the query, so an inner join, a reversed coalesce or a per-row " +
    "rather than per-column merge is invisible without a database.",
});

describe.skipIf(!connectionString)("F2.6 — calc resolution merge", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.6");
    pool = created;
    // `F3.39`: see `registerFixturePointKeys` — `0057` makes point_key a
    // foreign key, and these codes are in no catalog.
    releasePointKeys = await registerFixturePointKeys(created, [
      "F26_MERGE_DERIVED",
      "F26_MERGE_MEASURED",
    ]);
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

  // Each case seeds at (org, TEST_TEMPLATE_CODE, version) —
  // asset_templates_org_code_version_unique means a prior case's rows must be
  // gone first.
  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("case 1 — a derived point with no asset_points row inherits every value", async () => {
    if (!pool) throw new Error("pool required");
    await assertNoRowInheritsEverything(pool, fx);
  });

  it("case 2 — an all-NULL asset_points row resolves identically to no row", async () => {
    if (!pool) throw new Error("pool required");
    await assertAllNullRowIsIdenticalToNoRow(pool, fx);
  });

  it("case 3 — each column overrides independently, the rest stay inherited", async () => {
    if (!pool) throw new Error("pool required");
    await assertEachColumnOverridesIndependently(pool, fx, cleanup);
  });

  it("case 4 — a full override takes nothing from the template", async () => {
    if (!pool) throw new Error("pool required");
    await assertFullOverrideTakesNothingFromTemplate(pool, fx);
  });

  it("case 5 — an override on one asset does not leak to another on the same version", async () => {
    if (!pool) throw new Error("pool required");
    await assertOverrideDoesNotLeakBetweenAssets(pool, fx);
  });

  it("case 6 — assets on different versions resolve against their own pins", async () => {
    if (!pool) throw new Error("pool required");
    await assertEachAssetResolvesAgainstItsOwnPin(pool, fx);
  });

  it("case 7 — an inactive asset_points row still resolves and still overrides (D-2)", async () => {
    if (!pool) throw new Error("pool required");
    await assertInactiveRowStillResolves(pool, fx);
  });

  it("case 8 — a measured template point is never activated by an override", async () => {
    if (!pool) throw new Error("pool required");
    await assertMeasuredPointIsNeverActivatedByAnOverride(pool, fx);
  });

  it("case 9 — a row whose source_kind is not computed overrides nothing", async () => {
    if (!pool) throw new Error("pool required");
    await assertNonComputedRowOverridesNothing(pool, fx);
  });
});
