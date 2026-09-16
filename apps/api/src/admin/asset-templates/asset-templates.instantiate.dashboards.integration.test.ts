import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { AdminAssetTemplateDto } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { instantiateAssetsBodySchema } from "./asset-templates.schema";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import { AssetTemplateInstantiationService } from "./asset-templates-instantiate.service";
import { loadFixtures as loadBaseFixtures } from "./asset-templates.instantiate.integration.spec";
import {
  assertBackfillAuditRow,
  assertBackfillCreatesAndSkips,
  assertBackfillRefusesDraftAndLocationAdmin,
  assertInstantiateAuditCarriesDashboardCount,
  assertOneAssetGetsBothViews,
  assertSlugCollisionRollsBackTheBatch,
  assertTemplateWithoutDashboardsWritesNone,
  cleanup,
  loadDashboardFixtures,
  publishFixtureTemplate,
  publishPlainTemplate,
  type Fixtures,
  type Services,
} from "./asset-templates.instantiate.dashboards.integration.spec";

/**
 * `F3.2` / ADR 0067 — Vitest entry point for the per-asset default dashboards.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014); this file owns the
 * database lifecycle.
 *
 * The cases are **ordered**, unlike `F2.2`'s: G2 needs assets this fixture
 * instantiated and a second published version forked from the first, and G2c
 * needs a draft forked from that. Each still names its own asset codes, so a
 * failure says which claim broke rather than which one ran first.
 */
const connectionString = requireIntegrationDb({
  item: "F3.2",
  label: "per-asset default dashboard tests",
  because:
    "every claim here is a row: which dashboards exist after an instantiate, which columns " +
    "they carry, how many dashboard_widget_points a partially resolved chart wrote, and — " +
    "the one that matters most — that a taken slug leaves NO asset, point, rule or dashboard " +
    "behind. The report is compared against independent SQL precisely so a service that " +
    "grades its own work cannot pass.",
});

describe.skipIf(!connectionString)("F3.2 — per-asset default dashboards", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let fx: Fixtures;
  let template: AdminAssetTemplateDto;
  let plain: AdminAssetTemplateDto;
  let v2: AdminAssetTemplateDto;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F3.2");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.2",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.2",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.2",
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
    );
    const assetDashboards = new AssetDashboardsInstantiateService(
      fleetDb,
      tenantDb,
      templates,
      audit,
    );
    const instantiation = new AssetTemplateInstantiationService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      assetDashboards,
    );
    svc = {
      templates,
      instantiate: (jwt, templateId, body) =>
        instantiation.instantiate(jwt, templateId, instantiateAssetsBodySchema.parse(body)),
      dashboards: assetDashboards,
    };
    fx = await loadDashboardFixtures(created, await loadBaseFixtures(created));
    await cleanup(created);
    template = await publishFixtureTemplate(svc, fx);
    plain = await publishPlainTemplate(svc, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("writes one dashboard per view, stamped and scoped to the asset (G1, G1b, G1c)", async () => {
    await assertOneAssetGetsBothViews(svc, fx, pool as pg.Pool, template);
  });

  it("records the dashboard count on the instantiate audit row (G1d)", async () => {
    await assertInstantiateAuditCarriesDashboardCount(pool as pg.Pool, template);
  });

  it("writes nothing for a template whose content declares no dashboards (G1e)", async () => {
    await assertTemplateWithoutDashboardsWritesNone(svc, fx, pool as pg.Pool, plain);
  });

  it("rolls the whole batch back when a slug is already taken (G1f)", async () => {
    await assertSlugCollisionRollsBackTheBatch(svc, fx, pool as pg.Pool, template);
  });

  it("backfills the unstamped, skips the stamped, and stamps the version asked for (G2, G2b)", async () => {
    v2 = await assertBackfillCreatesAndSkips(svc, fx, pool as pg.Pool, template);
  });

  it("refuses a draft, and refuses a location admin before disclosing it (G2c)", async () => {
    await assertBackfillRefusesDraftAndLocationAdmin(svc, fx, v2);
  });

  it("leaves a master.dashboard.backfill audit row (G2d)", async () => {
    await assertBackfillAuditRow(pool as pg.Pool, v2);
  });
});
