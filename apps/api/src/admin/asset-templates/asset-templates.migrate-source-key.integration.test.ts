import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import { loadFixtures, type Fixtures } from "./asset-templates.instantiate.integration.spec";
import {
  assertAStoredVariableResolvesAMeasuredAddition,
  assertAnAssetMissingAStoredTokenNamesWhatItStores,
  assertAnAssetWithNoStoredVariablesIsStillRefused,
  assertExistingSourceKeyRefusesAMeasuredAddition,
  assertRacedPointKeyAnswers409,
  assertRacedSourceKeyAnswers409,
  assertTwoAdditionsWithOneSourceKeyAreRefused,
  cleanupSourceKey,
  SK_POINT_KEYS,
} from "./asset-templates.migrate-source-key.integration.spec";

/**
 * `F4.216` — Vitest entry point for the source-key cases of template version
 * migration. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the database lifecycle, wired exactly as
 * `asset-templates.migrate.integration.test.ts` wires the same service.
 */
const connectionString = requireIntegrationDb({
  item: "F4.216",
  label: "template migration source-key tests",
  because:
    "the guarantee is about asset_points_asset_source_key_idx, a unique index only " +
    "Postgres enforces: the plan must refuse a key an existing row holds, and a key " +
    "taken between the plan and the write must roll back as a 409 with nothing written. " +
    "Neither the refusal nor the rollback is observable without the real index.",
});

describe.skipIf(!connectionString)("F4.216 / F4.222 — template migration: source-key and point-key collisions", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplateMigrationService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F4.216");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.216",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.216",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.216",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetTemplateMigrationService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new CalcDependencyService(
        fleetDb,
        new CalcDefinitionsService(fleetDb, new MetricsService()),
        new CalcScopeService(fleetDb),
      ),
    );
    // `F3.39`/`F3.42`: these codes reach template_points and asset_points,
    // both of which reference point_keys(code). This suite's own codes, never
    // the migrate suite's — see the spec's docblock on point_keys isolation.
    releasePointKeys = await registerFixturePointKeys(created, SK_POINT_KEYS);
    fx = await loadFixtures(created);
    await cleanupSourceKey(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanupSourceKey(pool);
      await releasePointKeys?.();
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  // Each case seeds at (org, SK_TEMPLATE_CODE, version), so a prior case's
  // rows must be gone first (asset_templates_org_code_version_unique).
  beforeEach(async () => {
    if (pool) {
      await cleanupSourceKey(pool);
    }
  });

  it("resolves a measured addition from the asset's stored variables (F2.29)", async () => {
    await assertAStoredVariableResolvesAMeasuredAddition(pool as pg.Pool, svc, fx);
  });

  it("still refuses an asset that stores no variables, and says why (F2.29)", async () => {
    await assertAnAssetWithNoStoredVariablesIsStillRefused(pool as pg.Pool, svc, fx);
  });

  it("refuses an asset that stores {unit} but not {bay}, and names both (F2.29)", async () => {
    await assertAnAssetMissingAStoredTokenNamesWhatItStores(pool as pg.Pool, svc, fx);
  });

  it("refuses a measured addition whose source key another point on the asset already uses", async () => {
    if (!pool) throw new Error("pool required");
    await assertExistingSourceKeyRefusesAMeasuredAddition(pool, svc, fx);
  });

  it("refuses two measured additions whose patterns resolve to one source key on an asset", async () => {
    if (!pool) throw new Error("pool required");
    await assertTwoAdditionsWithOneSourceKeyAreRefused(pool, svc, fx);
  });

  it("answers 409, not 500, when a source key is taken between the plan and the write", async () => {
    if (!pool) throw new Error("pool required");
    await assertRacedSourceKeyAnswers409(pool, svc, fx);
  });

  it("answers 409, not 500, when a point key is taken between the plan and the write", async () => {
    if (!pool) throw new Error("pool required");
    await assertRacedPointKeyAnswers409(pool, svc, fx);
  });
});
