import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import {
  assertCacheIsNotReReadWithinTtl,
  assertHandCreatedAssetContributesNothing,
  assertLoaderGoesDarkOnBareTenantPool,
  assertLoaderResolvesValidRowsAndSkipsInvalidOnes,
  assertTheTwoHopCycleWritesNothingAndTheHealthyFormulaStillWrites,
  assertV1ReferencingADerivedSiblingIsRefused,
  cleanup,
  FIXTURE_DERIVED_POINT_KEYS,
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
  let tenantPool: pg.Pool | undefined;
  let fx: Fixtures;
  let removeFixtureKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.4");
    pool = created;
    // E7.1b: the bare tenant pool (no GUC) for the fleetDb-routing regression guard.
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ??
        asRole(connectionString as string, "bms_tenant", "bms_tenant_dev"),
      "F2.4",
    );
    fx = await loadFixtures(created);
    await cleanup(created);
    // `F3.42`: `0058` makes `template_points.point_key` a foreign key, and the
    // derived rows each case seeds carry invented codes. The product reaches
    // this state through `replacePoints`, which gates every code against the
    // catalog first; a fixture that writes the row itself must register it.
    removeFixtureKeys = await registerFixturePointKeys(created, FIXTURE_DERIVED_POINT_KEYS);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      // After `cleanup`, which removes the template_points rows that reference
      // these codes.
      if (removeFixtureKeys) {
        await removeFixtureKeys();
      }
      await pool.end();
    }
    if (tenantPool) {
      await tenantPool.end();
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

  it("resolves nothing on a bare tenant pool — proves the read must be on fleet", async () => {
    if (!pool || !tenantPool) throw new Error("pools required");
    await assertLoaderGoesDarkOnBareTenantPool(pool, tenantPool, fx);
  });

  it("refuses a v1 definition that references a derived point on its own asset, and counts it", async () => {
    if (!pool) throw new Error("pool required");
    await assertV1ReferencingADerivedSiblingIsRefused(pool, fx);
  });

  it("writes neither half of a two-hop v1 cycle, and still writes the healthy formula beside it", async () => {
    if (!pool) throw new Error("pool required");
    await assertTheTwoHopCycleWritesNothingAndTheHealthyFormulaStillWrites(pool, fx);
  });
});
