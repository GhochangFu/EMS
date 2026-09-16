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
  cleanup,
  loadDashboardFixtures,
  publishFixtureTemplate,
  publishPlainTemplate,
  type Fixtures,
  type Services,
} from "./asset-templates.instantiate.dashboards.integration.spec";
import {
  assertAFailingChunkKeepsTheEarlierChunks,
  assertBackfillAuditRow,
  assertBackfillCreatesAndSkips,
  assertBackfillOfAViewlessTemplateIsRefused,
  assertBackfillRefusesDraftAndLocationAdmin,
  type BackfilledVersion,
} from "./asset-templates.instantiate.dashboards-backfill.integration.spec";

/**
 * `F3.2` / ADR 0067 decision 4 and Q7 — Vitest entry point for the backfill.
 * Assertions live in the sibling `.spec` (§4.6 / ADR 0014); this file owns the
 * database lifecycle.
 *
 * A pair of its own since the §4.2 split of 2026-09-17 — see that spec's
 * docblock. It builds the same services and the same fixture template as
 * `asset-templates.instantiate.dashboards.integration.test.ts`, from that
 * file's own exported builders, and its per-run code suffixes are evaluated in
 * this file's module registry, so the two runs sweep only their own rows.
 *
 * The cases are **ordered**: G2 publishes the second version G2f, G2c and G2d
 * all take, and G2d grades the audit rows G2's call left. Each still names its
 * own asset codes, so a failure says which claim broke.
 */
const connectionString = requireIntegrationDb({
  item: "F3.2",
  label: "per-asset default dashboard backfill tests",
  because:
    "every claim here is a row: which assets the backfill created for and which it skipped, " +
    "which version its dashboards are stamped with, that a chunk committed before a failing " +
    "one survives the failure, and that a re-run resumes rather than duplicating. The report " +
    "is compared against independent SQL precisely so a service that grades its own work " +
    "cannot pass.",
});

describe.skipIf(!connectionString)("F3.2 — the per-asset default dashboard backfill", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let fx: Fixtures;
  let template: AdminAssetTemplateDto;
  let plain: AdminAssetTemplateDto;
  let backfilled: BackfilledVersion;

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

  it("refuses the backfill of a version that declares no dashboard view (G2e)", async () => {
    await assertBackfillOfAViewlessTemplateIsRefused(svc, fx, pool as pg.Pool, plain);
  });

  it("backfills the unstamped, skips the stamped, and stamps the version asked for (G2, G2b)", async () => {
    backfilled = await assertBackfillCreatesAndSkips(svc, fx, pool as pg.Pool, template);
  });

  it("keeps the chunks committed before a failing one, and resumes on a re-run (G2f)", async () => {
    await assertAFailingChunkKeepsTheEarlierChunks(svc, fx, pool as pg.Pool, backfilled.version);
  });

  it("refuses a draft, and refuses a location admin before disclosing it (G2c)", async () => {
    await assertBackfillRefusesDraftAndLocationAdmin(svc, fx, backfilled.version);
  });

  it("leaves a master.dashboard.backfill audit row (G2d)", async () => {
    await assertBackfillAuditRow(pool as pg.Pool, backfilled);
  });
});
