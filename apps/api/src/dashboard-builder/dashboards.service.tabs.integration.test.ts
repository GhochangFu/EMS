import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { DashboardsService } from "./dashboards.service";
import {
  aGroupAtAnotherSiteIsRefused,
  aGroupOfAnotherOrganizationIsRefused,
  aKeptWidgetSurvivesTheDeleteOfItsOldTab,
  patchOnAnOverviewOnlyDashboardSucceeds,
  patchToAGroupScopeIsRefused,
  patchToAnotherSiteIsRefused,
  patchToOrgWideIsRefused,
  putWithTabsStoresTabIds,
  theFleetReadOmitsAForeignStampedTab,
  twoTabsSwapTheirKeys,
  type TabsFixture,
} from "./dashboards.service.tabs.integration.spec";

/**
 * `F3.73` Task 1.4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle, this run's fixture and its cleanup. The cases run in order
 * and share one site dashboard: the first PUT writes the tabs the later cases read.
 */
const connectionString = requireIntegrationDb({
  item: "F3.73",
  label: "DashboardsService tabs — tab_id writes, the location-move 400 and the fleet predicate",
  because:
    "the same-location rule lives in a composite foreign key and the tab read's organization " +
    "predicate matters only on the BYPASSRLS fleet pool — facts about a real database that a " +
    "fake db cannot prove.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.73 — DashboardsService tabs against a real database", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const dashboardIds: string[] = [];
  const groupIds: string[] = [];
  let f: TabsFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 2 } as const;
    fleetPool = await openIntegrationPool(url, "F3.73", POOL);
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.73", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.73",
      POOL,
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.73",
      POOL,
    );
    const fleetDb = createDb(fleetPool);

    const orgs = await fleetPool.query<{ code: string; id: string }>(
      `SELECT code, id FROM bms.organizations WHERE code IN ('ESKOM', 'PHEWB')`,
    );
    const orgId = (code: string): string => orgs.rows.find((row) => row.code === code)?.id ?? "";
    const eskomOrgId = orgId("ESKOM");
    const phewbOrgId = orgId("PHEWB");
    if (!eskomOrgId || !phewbOrgId) {
      throw new Error("F3.73: ESKOM/PHEWB organizations not found — run pnpm db:seed");
    }
    // F4.53: the OLDEST rows are seeded ones, which no concurrent suite deletes mid-run.
    const locationsOf = async (organizationId: string): Promise<string[]> =>
      (
        await fleetPool.query<{ id: string }>(
          `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 2`,
          [organizationId],
        )
      ).rows.map((row) => row.id);
    const [here, elsewhere] = await locationsOf(eskomOrgId);
    const [phewbSite] = await locationsOf(phewbOrgId);
    if (!here || !elsewhere || !phewbSite) {
      throw new Error("F3.73: ESKOM needs two locations and PHEWB one — run pnpm db:seed");
    }
    const group = async (organizationId: string, locationId: string, code: string): Promise<string> => {
      const row = await fleetPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, 'F3.73 tabs fixture') RETURNING id`,
        [organizationId, locationId, `${code}-${RUN}`],
      );
      const id = row.rows[0]?.id ?? "";
      groupIds.push(id);
      return id;
    };
    const groupHereId = await group(eskomOrgId, here, "f373-here");
    const groupElsewhereId = await group(eskomOrgId, elsewhere, "f373-elsewhere");
    const phewbGroupId = await group(phewbOrgId, phewbSite, "f373-phewb");

    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
    const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
    const actor = jwtFor(SEEDED.globalAdmin, "admin");

    const create = async (slug: string): Promise<string> => {
      const created = await service.create(actor, {
        organizationId: eskomOrgId,
        slug,
        name: "F3.73 tabs fixture",
        locationId: here,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(created.id);
      return created.id;
    };
    const siteDashboardSlug = `f373-tabs-${RUN}`;
    const siteDashboardId = await create(siteDashboardSlug);
    const overviewOnlyDashboardId = await create(`f373-overview-${RUN}`);
    const swapDashboardId = await create(`f373-swap-${RUN}`);
    await service.putWidgets(actor, overviewOnlyDashboardId, {
      tabs: [{ key: "overview", label: "Overview", sortOrder: 0 }],
      widgets: [],
    });

    f = {
      service,
      actor,
      fleetPool,
      superuserPool,
      phewbOrgId,
      siteDashboardId,
      siteDashboardSlug,
      overviewOnlyDashboardId,
      swapDashboardId,
      otherLocationId: elsewhere,
      groupHereId,
      groupElsewhereId,
      phewbGroupId,
    };
  }, 60_000);

  afterAll(async () => {
    // Dashboards first: they cascade their tabs, whose group FK is ON DELETE RESTRICT.
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    if (groupIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])`, [groupIds]);
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("a PUT with tabs stores each widget's tab_id", async () => {
    await putWithTabsStoresTabIds(f);
  }, 60_000);

  it("a kept widget survives the delete of its old tab", async () => {
    await aKeptWidgetSurvivesTheDeleteOfItsOldTab(f);
  }, 60_000);

  it("two kept tabs swap their keys and keep their widgets", async () => {
    await twoTabsSwapTheirKeys(f);
  }, 60_000);

  it("PATCH locationId to another site is a 400", async () => {
    await patchToAnotherSiteIsRefused(f);
  }, 60_000);

  it("PATCH locationId: null (org-wide) is a 400, not a 500", async () => {
    await patchToOrgWideIsRefused(f);
  }, 60_000);

  it("PATCH to an assetGroupId scope is a 400", async () => {
    await patchToAGroupScopeIsRefused(f);
  }, 60_000);

  it("PATCH on a dashboard whose only tab is Overview succeeds", async () => {
    await patchOnAnOverviewOnlyDashboardSucceeds(f);
  }, 60_000);

  it("a tab naming a group of another organization is a 400 that never echoes the id", async () => {
    await aGroupOfAnotherOrganizationIsRefused(f);
  }, 60_000);

  it("a tab naming a group at another site is a 400", async () => {
    await aGroupAtAnotherSiteIsRefused(f);
  }, 60_000);

  it("the fleet read omits a tab stamped with another organization", async () => {
    await theFleetReadOmitsAForeignStampedTab(f);
  }, 60_000);
});
