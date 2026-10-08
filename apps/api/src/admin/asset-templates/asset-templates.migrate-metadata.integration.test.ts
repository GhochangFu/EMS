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
  DERIVED_KEY,
  MEASURED_KEY,
  assertAMetadataDefaultOnlyChangeIsReportedByPreview,
  assertAMetadataOverrideInvalidOnTargetRefusesAndPinsNothing,
  assertAllFiveDefaultsAreReadByPreview,
  cleanup,
} from "./asset-templates.migrate-metadata.integration.spec";

/**
 * `F2.24` / `F2.30` — Vitest entry point for the measured-metadata side of a
 * template migration. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.24",
  label: "migrate-time metadata defaults",
  because:
    "the claim is that the migration service projects the five stored defaults into the " +
    "delta — a projection that forgot one compares undefined to undefined and reports " +
    "nothing, which no pure test of the delta can see. The default is a template_points row.",
});

describe.skipIf(!connectionString)("F2.24 — migration reads the five metadata defaults", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplateMigrationService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F2.24");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.24",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.24",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.24",
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
    releasePointKeys = await registerFixturePointKeys(created, [MEASURED_KEY, DERIVED_KEY]);
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  // Every case seeds at (org, TEST_TEMPLATE_CODE, version), and
  // asset_templates_org_code_version_unique means the previous case's rows must
  // be gone first.
  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("reports a metadata-default-only version change in migration-preview (F2.24)", async () => {
    if (!pool) throw new Error("pool required");
    await assertAMetadataDefaultOnlyChangeIsReportedByPreview(pool, svc, fx);
  });

  it("reads every one of the five defaults, so a change to any of them is reported (F2.24)", async () => {
    if (!pool) throw new Error("pool required");
    await assertAllFiveDefaultsAreReadByPreview(pool, svc, fx);
  });

  it("refuses a migrate whose target default inverts an asset's own override, and moves no pin (F2.30)", async () => {
    if (!pool) throw new Error("pool required");
    await assertAMetadataOverrideInvalidOnTargetRefusesAndPinsNothing(pool, svc, fx);
  });
});
