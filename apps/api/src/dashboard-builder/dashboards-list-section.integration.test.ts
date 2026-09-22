import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import type { SectionListFixtures } from "./dashboards-list-section.integration.spec";
import {
  assertAssetIdAndSectionCompose,
  assertSectionFilterExcludesOtherSectionsAndHandBuiltRows,
  assertSectionFilterReturnsTheStampedDashboard,
  assertUnfilteredListStillContainsAHandBuiltDashboard,
  assertUnknownSectionAnswersEmpty,
} from "./dashboards-list-section.integration.spec";
import { DashboardsService } from "./dashboards.service";

/**
 * `E4.2` U9 — Vitest entry point. Owns the fixtures and cleanup; the assertions
 * live in the sibling `.spec` (ADR 0014).
 *
 * The actor is `wc-admin@bms.local`, a `location_admin` **of ESKOM** — a
 * single-organization caller, so `withOrganizationReadScope` takes the TENANT
 * branch and the new join actually runs as `bms_tenant` under FORCE RLS. A
 * global admin would take the fleet branch, where `bms_fleet` holds `BYPASSRLS`
 * and a missing grant on `bms.dashboard_templates` would never show. Reading a
 * dashboard list is organization-wide for every role (`list()`'s own docblock),
 * so this actor sees all four fixtures.
 *
 * **Cleanup is by id, and only the ids this suite created** — `F3.37`'s review
 * found an `afterAll` that erased every organization's real history on a
 * developer database.
 */
const connectionString = requireIntegrationDb({
  item: "E4.2",
  label: "GET /dashboards?section= — the join onto bms.dashboard_templates",
  because:
    "whether `bms_tenant` may SELECT `bms.dashboard_templates` under FORCE RLS, and whether a " +
    "hand-built dashboard (template_id IS NULL) survives the join, are facts about real grants " +
    "and real rows. A fake db returns whatever it is told to.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const SUSTAINABILITY_TEMPLATE_CODE = `e42-sec-sust-${RUN}`;
const ELECTRICAL_TEMPLATE_CODE = `e42-sec-elec-${RUN}`;
const SUSTAINABILITY_SLUG = `e42-sec-sust-dash-${RUN}`;
const ELECTRICAL_SLUG = `e42-sec-elec-dash-${RUN}`;
const HAND_BUILT_SLUG = `e42-sec-hand-${RUN}`;
const ASSET_SCOPED_SLUG = `e42-sec-asset-${RUN}`;

const EMPTY_CONTENT = JSON.stringify({ widgets: [] });

describe.skipIf(!connectionString)("E4.2 — GET /dashboards?section=", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetDb: BmsDb;
  let service: DashboardsService;

  const templateIds: string[] = [];
  const dashboardIds: string[] = [];
  let fixtures: SectionListFixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.2",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.2",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E4.2",
    );
    fleetDb = createDb(await openIntegrationPool(url, "E4.2"));

    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    service = new DashboardsService(
      tenantDb,
      fleetDb,
      accessControl,
      new MasterDataAuditService(tenantDb, fleetDb),
    );

    const orgs = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
    );
    const eskomOrgId = orgs.rows[0]?.id;
    if (!eskomOrgId) {
      throw new Error("E4.2: the ESKOM organization is not there — run pnpm db:seed");
    }

    // `F4.53` — the OLDEST row is a seeded one, which predates every suite in
    // the run and is the only one no concurrent suite can delete underneath us.
    const asset = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.assets WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [eskomOrgId],
    );
    const assetId = asset.rows[0]?.id;
    if (!assetId) throw new Error("E4.2: ESKOM has no asset — run pnpm db:seed");

    const template = async (code: string, section: string): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content, published_at)
         VALUES ($1, $2, 1, $3, $4, 'published', $5, now()) RETURNING id`,
        [eskomOrgId, code, `E4.2 ${section} fixture`, section, EMPTY_CONTENT],
      );
      const id = row.rows[0]?.id ?? "";
      templateIds.push(id);
      return id;
    };

    const sustainabilityTemplateId = await template(
      SUSTAINABILITY_TEMPLATE_CODE,
      "sustainability",
    );
    const electricalTemplateId = await template(ELECTRICAL_TEMPLATE_CODE, "electrical");

    const dashboard = async (
      slug: string,
      templateId: string | null,
      scopedAssetId: string | null,
    ): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, template_id, asset_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [eskomOrgId, slug, `E4.2 ${slug}`, templateId, scopedAssetId],
      );
      const id = row.rows[0]?.id ?? "";
      dashboardIds.push(id);
      return id;
    };

    fixtures = {
      sustainabilityDashboardId: await dashboard(
        SUSTAINABILITY_SLUG,
        sustainabilityTemplateId,
        null,
      ),
      electricalDashboardId: await dashboard(ELECTRICAL_SLUG, electricalTemplateId, null),
      handBuiltDashboardId: await dashboard(HAND_BUILT_SLUG, null, null),
      assetScopedSustainabilityDashboardId: await dashboard(
        ASSET_SCOPED_SLUG,
        sustainabilityTemplateId,
        assetId,
      ),
      assetId,
    };
  }, 60_000);

  afterAll(async () => {
    if (dashboardIds.length > 0) {
      await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [
        dashboardIds,
      ]);
    }
    if (templateIds.length > 0) {
      await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [
        templateIds,
      ]);
    }
    await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  const actor = () => jwtFor(SEEDED.locationAdmin, "location_admin");

  it("the unfiltered list still contains a hand-built dashboard (the LEFT-join control)", async () => {
    await assertUnfilteredListStillContainsAHandBuiltDashboard(service, actor(), fixtures);
  }, 60_000);

  it("section=sustainability returns the sustainability-stamped dashboard", async () => {
    await assertSectionFilterReturnsTheStampedDashboard(service, actor(), fixtures);
  }, 60_000);

  it("section=sustainability excludes another section and the hand-built row", async () => {
    await assertSectionFilterExcludesOtherSectionsAndHandBuiltRows(service, actor(), fixtures);
  }, 60_000);

  it("an unknown section answers []", async () => {
    await assertUnknownSectionAnswersEmpty(service, actor());
  }, 60_000);

  it("assetId and section compose", async () => {
    await assertAssetIdAndSectionCompose(service, actor(), fixtures);
  }, 60_000);
});
