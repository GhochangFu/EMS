import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { DashboardTemplatesInstantiateService } from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import { DashboardTemplatesService } from "../admin/dashboard-templates/dashboard-templates.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { DashboardsService } from "../dashboard-builder/dashboards.service";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import {
  type SiteLayoutCtx,
  assertAmbiguousSiteAnswersCandidates,
  assertBuiltinSiteIsRefused,
  assertForeignGroupChoiceIsRefused,
  assertForeignTemplateIsNotFound,
  assertInsertNeverOverwritesALiveRow,
  assertLocationAdminOfAnotherSiteIsForbidden,
  assertLocationAdminOfTheSiteMayMake,
  assertNewestPublishedTemplateIsTheDefault,
  assertOperatorIsForbidden,
  assertRaceNeverOverwritesALiveCopy,
  assertRemovedCopyIsRemadeInPlace,
  assertSecondCallIsRefused,
  assertZeroGroupSiteGetsGroupsAndACopy,
  newOrganization,
  newSiteTemplate,
  serviceWithViewRow,
} from "./site-layout.service.integration.spec";
import {
  assertBulkMakesAndReportsSkips,
  assertBulkRefusesALocationAdmin,
  assertConcurrentCopyAnswers409,
  assertGetBySlugCarriesTheStamp,
  assertInstantiateSiteArmMakesTheCopy,
  assertMimicNodesResolveThroughTheTabGroup,
  assertNoPublishedSiteTemplateAnswers409,
  assertTakenSlugAnswers409,
} from "./site-layout.service.more.integration.spec";
import { SiteLayoutService, siteTemplateArmOf } from "./site-layout.service";

/**
 * `F3.73` plan Task 4.2 — Vitest entry point for `SiteLayoutService` under real RLS, on the
 * `site-control-room-view.integration.test.ts` harness. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the stale sweep and the cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F3.73",
  label: "SiteLayoutService against real, non-owner roles",
  because:
    "the copy writes groups, a tabbed dashboard and the site view row in one withTenant " +
    "transaction under FORCE RLS, and the rules it holds — never replace a live or builtin row, " +
    "re-point a removed copy in place, write nothing for an ambiguous site — are row states a " +
    "mock cannot show.",
});

/**
 * Child-first removal of everything under the given organizations and locations. The groups,
 * dashboards and view rows the SERVICE made are not registered, so they go by `location_id`;
 * dashboards before groups (a tab's group FK is RESTRICT), audit rows before users.
 */
async function removeFixtures(
  pool: pg.Pool,
  superuserPool: pg.Pool,
  sel: { orgs: string; locations: string; templates: string; users: string },
): Promise<void> {
  const params: unknown[] = [];
  await pool.query(`DELETE FROM bms.audit_log WHERE organization_id IN (${sel.orgs}) OR entity_id IN (${sel.locations})`, params);
  await pool.query(`DELETE FROM bms.site_control_room_views WHERE location_id IN (${sel.locations})`, params);
  await pool.query(`DELETE FROM bms.dashboards WHERE location_id IN (${sel.locations})`, params);
  await pool.query(
    `DELETE FROM bms.asset_group_members WHERE asset_group_id IN
       (SELECT id FROM bms.asset_groups WHERE location_id IN (${sel.locations}))`,
    params,
  );
  await pool.query(`DELETE FROM bms.asset_groups WHERE location_id IN (${sel.locations})`, params);
  await pool.query(`DELETE FROM bms.assets WHERE location_id IN (${sel.locations})`, params);
  await pool.query(`DELETE FROM bms.dashboard_templates WHERE id IN (${sel.templates})`, params);
  // `bms_fleet` holds no privilege on `bms.users`; the fixture user is the superuser's to remove.
  await superuserPool.query(`DELETE FROM bms.user_location_access WHERE user_id IN (${sel.users})`);
  await superuserPool.query(`DELETE FROM bms.users WHERE id IN (${sel.users})`);
  await pool.query(`DELETE FROM bms.locations WHERE id IN (${sel.locations})`, params);
  await pool.query(`DELETE FROM bms.organizations WHERE id IN (${sel.orgs})`, params);
}

/** Reaps what a killed earlier run committed: fixtures older than 30 minutes. */
async function sweepStaleRuns(pool: pg.Pool, superuserPool: pg.Pool): Promise<void> {
  const old = "created_at < now() - interval '30 minutes'";
  try {
    await removeFixtures(
      pool,
      superuserPool,
      {
        orgs: `SELECT id FROM bms.organizations WHERE code LIKE 'F373SL-%' AND ${old}`,
        locations: `SELECT id FROM bms.locations WHERE code LIKE 'F373SL-%' AND ${old}`,
        templates: `SELECT id FROM bms.dashboard_templates WHERE code LIKE 'f373sl-%' AND ${old}`,
        users: `SELECT id FROM bms.users WHERE email LIKE 'f373sl-%' AND ${old}`,
      },
    );
  } catch (err) {
    process.stderr.write(
      "[F3.73] could not sweep stale site-layout fixtures: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("F3.73 — SiteLayoutService under real RLS", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superuserPool: pg.Pool;
  let ctx: SiteLayoutCtx;
  let eskomTemplateId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.73");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.73",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.73",
    );
    // Only for the S6 location-admin fixture user: `bms_fleet` may not write `bms.users`.
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.73");
    await sweepStaleRuns(fleetPool, superuserPool);

    const { rows: eskom } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    if (!eskom[0]) throw new Error("F3.73: ESKOM is not seeded — run pnpm db:seed.");
    const { rows: rsmoc } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`);
    if (!rsmoc[0]) throw new Error("F3.73: RSMOC-WC is not seeded — run pnpm db:seed.");

    const run = `${Date.now()}-${randomUUID().slice(0, 4)}`;
    const created: SiteLayoutCtx["created"] = { organizations: [], locations: [], templates: [], users: [] };
    const orgId = await newOrganization(fleetPool, run, created);
    const templateId = await newSiteTemplate(fleetPool, orgId, run, created);
    eskomTemplateId = await newSiteTemplate(fleetPool, eskom[0].id, `${run}-eskom`, created);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const base: ConstructorParameters<typeof SiteLayoutService> = [fleetDb, tenantDb, accessControl, audit];
    const svc = new SiteLayoutService(...base);
    const templates = new DashboardTemplatesService(fleetDb, tenantDb, accessControl, audit, new VocabulariesService(fleetDb));
    ctx = {
      svc,
      dashboards: new DashboardsService(tenantDb, fleetDb, accessControl, audit),
      mimicNodes: new MimicNodesService(fleetDb, fleetPool, accessControl),
      // The arm `AdminModule` provides: its factory is `siteTemplateArmOf`.
      instantiate: new DashboardTemplatesInstantiateService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        templates,
        siteTemplateArmOf(svc),
      ),
      make: (staged) => (staged === undefined ? new SiteLayoutService(...base) : serviceWithViewRow(base, staged)),
      fleetPool,
      superuserPool,
      run,
      orgId,
      templateId,
      eskomId: eskom[0].id,
      rsmocWcId: rsmoc[0].id,
      created,
    };
  });

  afterAll(async () => {
    if (ctx) {
      const { organizations, locations, templates, users } = ctx.created;
      // Database-generated uuids, so a literal array is safe and each query needs no parameter.
      const ids = (list: string[]): string => `SELECT unnest('{${list.join(",")}}'::uuid[])`;
      await removeFixtures(fleetPool, superuserPool, {
        orgs: ids(organizations),
        locations: ids(locations),
        templates: ids(templates),
        users: ids(users),
      });
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end(), superuserPool?.end()]);
  });

  it("S1 a site with no group gets one group per domain, a three-tab copy and its view row", async () => {
    await assertZeroGroupSiteGetsGroupsAndACopy(ctx);
  });

  it("S2 a second call on a live copy answers 409 SITE_HAS_VIEW_MESSAGE and writes nothing", async () => {
    await assertSecondCallIsRefused(ctx);
  });

  it("S2b a removed copy is re-made and the same view row re-pointed", async () => {
    await assertRemovedCopyIsRemadeInPlace(ctx);
  });

  it("S2c a row that went live after the pre-check is never overwritten; the copy rolls back", async () => {
    await assertRaceNeverOverwritesALiveCopy(ctx);
  });

  it("S2d a row that went live before the insert is never overwritten; the copy rolls back", async () => {
    await assertInsertNeverOverwritesALiveRow(ctx);
  });

  it("S3b another organization's template answers 404 on this site", async () => {
    await assertForeignTemplateIsNotFound(ctx, eskomTemplateId);
  });

  it("S8b no templateId copies the organization's newest published site template", async () => {
    await assertNewestPublishedTemplateIsTheDefault(ctx);
  });

  it("S3 RSMOC-WC's builtin row is never replaced", async () => {
    await assertBuiltinSiteIsRefused(ctx, eskomTemplateId);
  });

  it("S4 an ambiguous site answers 409 with the candidates and writes nothing", async () => {
    await assertAmbiguousSiteAnswersCandidates(ctx);
  });

  it("S5 tabGroups naming another organization's group answers 400 without the id", async () => {
    await assertForeignGroupChoiceIsRefused(ctx);
  });

  it("S6a the location admin of the site may make its layout", async () => {
    await assertLocationAdminOfTheSiteMayMake(ctx);
  });

  it("S6b a location admin of another site is refused with 403", async () => {
    await assertLocationAdminOfAnotherSiteIsForbidden(ctx);
  });

  it("S6c an operator is refused with 403", async () => {
    await assertOperatorIsForbidden(ctx);
  });

  it("S7 the bulk makes what it can and reports every skip; a made site survives the later ones", async () => {
    await assertBulkMakesAndReportsSkips(ctx);
  });

  it("S7b the bulk refuses a location admin with 403", async () => {
    await assertBulkRefusesALocationAdmin(ctx);
  });

  it("S8 an organization with no published site template answers 409 NO_SITE_TEMPLATE_MESSAGE", async () => {
    await assertNoPublishedSiteTemplateAnswers409(ctx);
  });

  it("S9 the copy's mimic nodes resolve through the tab's group", async () => {
    await assertMimicNodesResolveThroughTheTabGroup(ctx);
  });

  it("S10 getBySlug returns the copy's templateId and tabs", async () => {
    await assertGetBySlugCarriesTheStamp(ctx);
  });

  it("S11 a taken site-layout slug answers 409 SITE_LAYOUT_SLUG_TAKEN_MESSAGE, not 500", async () => {
    await assertTakenSlugAnswers409(ctx);
  });

  it("S13 instantiate with { locationId } makes the copy through the module's arm and audits once", async () => {
    await assertInstantiateSiteArmMakesTheCopy(ctx);
  });

  it("S14 a copy concurrent with another on the same site answers 409, not a raw 23505", async () => {
    await assertConcurrentCopyAnswers409(ctx);
  });
});
