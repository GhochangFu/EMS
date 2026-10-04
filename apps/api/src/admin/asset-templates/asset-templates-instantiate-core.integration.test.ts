import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import {
  assertCreateCoreHoldsOneTenantConnection,
  assertInstantiateCoreChecksTheCatalogThroughTheTransaction,
  assertInstantiateCoreHoldsOneTenantConnection,
  assertInstantiateCoreSeesALocationWrittenInTheSameTransaction,
  assertInstantiateCoreSeesARuleCodeWrittenInTheSameTransaction,
  assertInstantiateCoreSeesAnAssetCodeWrittenInTheSameTransaction,
  assertInstantiateCoreSeesAnRtuWrittenInTheSameTransaction,
  assertInstantiateCoreSeesATemplatePublishedInTheSameTransaction,
  cleanup,
  loadFixtures,
  assertPublishCoreHoldsOneTenantConnection,
  publishFixtureTemplates,
  type Harness,
} from "./asset-templates-instantiate-core.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F3.22` PR 1 — Vitest entry point for the instantiate core (ADR 0091 decision
 * 1). Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle, in the shape of `asset-templates-write-cores.integration.test.ts`:
 * four pools, the real services on the real `bms_tenant`/`bms_fleet` roles — the
 * real dashboards service too, as `AdminModule` wires it — cleanup before and after.
 */

const connectionString = requireIntegrationDb({
  item: "F3.22",
  label: "template instantiate-core transaction tests",
  because:
    "whether an instantiate guard sees an RTU, location, template, point key, asset or rule " +
    "written earlier in the same uncommitted transaction is a database behaviour — row " +
    "visibility under the bms_tenant role and FORCE row-level security. No fake can express " +
    "it, and a skipped run would leave PR 2's one-transaction commit resting on an unproven claim.",
});

describe.skipIf(!connectionString)("F3.22 — the instantiate core sees the transaction", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let singleTenantPool: pg.Pool | undefined;
  let h: Harness;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F3.22");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.22",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.22",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.22",
    );

    // C11–C13: one tenant connection, and a connect timeout well under the test
    // timeout, so a core that asks for a second connection fails with the pool's
    // own message rather than hanging the run.
    singleTenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.22",
      { max: 1, connectionTimeoutMillis: 2_000 },
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const templates = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      new CalcParametersService(fleetDb),
    );
    const assetDashboards = new AssetDashboardsInstantiateService(
      fleetDb,
      tenantDb,
      templates,
      audit,
      access,
    );
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      assetDashboards,
    );

    const singleDb = createDb(singleTenantPool);
    const singleAudit = new MasterDataAuditService(singleDb, fleetDb);
    const singleVocabularies = new VocabulariesService(singleDb);
    const singleTemplates = new AssetTemplatesAdminService(
      fleetDb,
      singleDb,
      access,
      singleAudit,
      singleVocabularies,
      new CalcParametersService(fleetDb),
    );
    const single = {
      tenantDb: singleDb,
      templates: singleTemplates,
      instantiation: new AssetTemplateInstantiationService(
        fleetDb,
        singleDb,
        access,
        singleAudit,
        singleVocabularies,
        new AssetDashboardsInstantiateService(
          fleetDb,
          singleDb,
          singleTemplates,
          singleAudit,
          access,
        ),
      ),
    };

    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    const fx = await loadFixtures(created);
    const published = await publishFixtureTemplates(templates, fx);
    h = { tenantDb, pool: created, templates, instantiation, fx, ...published, single };
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([
      pool?.end(),
      authPool?.end(),
      tenantPool?.end(),
      fleetPool?.end(),
      singleTenantPool?.end(),
    ]);
  });

  it("C5: the instantiate core sees an RTU written in the same transaction", async () => {
    await assertInstantiateCoreSeesAnRtuWrittenInTheSameTransaction(h);
  });

  it("C6: the instantiate core sees a location written in the same transaction", async () => {
    await assertInstantiateCoreSeesALocationWrittenInTheSameTransaction(h);
  });

  it("C7: the instantiate core sees a template published in the same transaction", async () => {
    await assertInstantiateCoreSeesATemplatePublishedInTheSameTransaction(h);
  });

  it("C8: the instantiate core checks the point-key catalog through the transaction", async () => {
    await assertInstantiateCoreChecksTheCatalogThroughTheTransaction(h);
  });

  it("C9: the instantiate core sees an asset code written in the same transaction", async () => {
    await assertInstantiateCoreSeesAnAssetCodeWrittenInTheSameTransaction(h);
  });

  it("C10: the instantiate core sees a rule code written in the same transaction", async () => {
    await assertInstantiateCoreSeesARuleCodeWrittenInTheSameTransaction(h);
  });

  it("C11: the create core makes every tenant read on its one connection", async () => {
    await assertCreateCoreHoldsOneTenantConnection(h);
  });

  it("C12: the publish core makes every tenant read on its one connection", async () => {
    await assertPublishCoreHoldsOneTenantConnection(h);
  });

  it("C13: the instantiate core makes every tenant read on its one connection", async () => {
    await assertInstantiateCoreHoldsOneTenantConnection(h);
  });
});
