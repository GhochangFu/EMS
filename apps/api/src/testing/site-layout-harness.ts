import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll } from "vitest";

import { createDb } from "@bms/db";

import { DashboardTemplatesInstantiateService } from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import { DashboardTemplatesService } from "../admin/dashboard-templates/dashboard-templates.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { DashboardsService } from "../dashboard-builder/dashboards.service";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import { asRole } from "./role-urls";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import {
  type SiteLayoutCtx,
  newOrganization,
  newSiteTemplate,
  serviceWithViewRow,
} from "../control-room/site-layout.service.integration.spec";
import { SiteLayoutService, siteTemplateArmOf } from "../control-room/site-layout.service";
import { primeSeededSubjects } from "./seeded-subjects";

/**
 * `F3.73` plan Task 4.2 — the shared harness for the two `SiteLayoutService` integration wrappers,
 * `site-layout.service.integration.test.ts` (S1–S6, S2b–S2d, S3b, S8b) and
 * `site-layout.service.more.integration.test.ts` (S7–S14). One `.test` wrapper per `.spec`
 * (`tests/repo-invariants.test.ts`), so each wrapper calls `useSiteLayoutHarness` inside its own
 * `describe` and gets its own pools, its own run-unique `F373SL-<run>-…` fixture codes and its own
 * cleanup — the two files may run in parallel workers without sharing a row.
 *
 * It lives in `src/testing/` rather than beside the service because it is neither a `.spec` nor a
 * `.test`: `tsconfig.build.json` excludes `src/testing/**` from the runtime bundle, and
 * `tests/repo-invariants.test.ts` refuses a non-test file outside `testing/` that imports from it.
 * Not a `.test.ts`, so Vitest does not collect it; it is type-checked as an import of the
 * wrappers. The assertions stay in the `.spec` files (ADR 0014, AGENTS.md §4.6).
 *
 * **It does not import `integration-db-gate`.** `tests/adr-0045-owner-and-superuser-url.test.ts`
 * holds that only a `.spec`/`.test` file may, so each wrapper calls `requireIntegrationDb` with
 * `SITE_LAYOUT_DB_GATE` and hands the harness its connection string and the gate's pool openers.
 */
export const SITE_LAYOUT_DB_GATE = {
  item: "F3.73",
  label: "SiteLayoutService against real, non-owner roles",
  because:
    "the copy writes groups, a tabbed dashboard and the site view row in one withTenant " +
    "transaction under FORCE RLS, and the rules it holds — never replace a live or builtin row, " +
    "re-point a removed copy in place, write nothing for an ambiguous site — are row states a " +
    "mock cannot show.",
};

/** What the wrapper's gate supplies: `openIntegrationPool` and `resolveIntegrationRoleUrl`, bound. */
export type SiteLayoutDbAccess = {
  /** `requireIntegrationDb(SITE_LAYOUT_DB_GATE)` — the fleet URL; the describe is skipped without it. */
  connectionString: string | undefined;
  openPool: (url: string) => Promise<pg.Pool>;
  superuserUrl: (url: string) => string;
};

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

/**
 * Reaps what a killed earlier run committed: fixtures older than 30 minutes. The age bound is what
 * keeps the sibling wrapper's live run, in a parallel worker, out of reach.
 */
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

export type SiteLayoutHarness = {
  /** The context the `.spec` assertions take; set by `beforeAll`. */
  ctx: () => SiteLayoutCtx;
  /** ESKOM's fixture site template (S3, S3b); empty unless `eskomTemplate` was asked for. */
  eskomTemplateId: () => string;
};

/**
 * Registers the `beforeAll`/`afterAll` pair on the calling `describe`. `tag` goes into the run id,
 * so the two wrappers' fixture codes differ even when both start in the same millisecond.
 * `eskomTemplate` adds a published site template to ESKOM; only the wrapper whose cases need it
 * asks, so the other never writes into a seeded organization.
 */
export function useSiteLayoutHarness(
  db: SiteLayoutDbAccess,
  opts: { tag: string; eskomTemplate?: boolean },
): SiteLayoutHarness {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superuserPool: pg.Pool;
  let ctx: SiteLayoutCtx | undefined;
  let eskomTemplateId = "";

  beforeAll(async () => {
    const url = db.connectionString as string;
    fleetPool = await db.openPool(url);
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    authPool = await db.openPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"));
    tenantPool = await db.openPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"));
    // Only for the S6 location-admin fixture user: `bms_fleet` may not write `bms.users`.
    superuserPool = await db.openPool(db.superuserUrl(url));
    await sweepStaleRuns(fleetPool, superuserPool);

    const { rows: eskom } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    if (!eskom[0]) throw new Error("F3.73: ESKOM is not seeded — run pnpm db:seed.");
    const { rows: rsmoc } = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.locations WHERE code = 'RSMOC-WC'`);
    if (!rsmoc[0]) throw new Error("F3.73: RSMOC-WC is not seeded — run pnpm db:seed.");

    const run = `${Date.now()}-${randomUUID().slice(0, 4)}${opts.tag}`;
    const created: SiteLayoutCtx["created"] = { organizations: [], locations: [], templates: [], users: [] };
    const orgId = await newOrganization(fleetPool, run, created);
    const templateId = await newSiteTemplate(fleetPool, orgId, run, created);
    if (opts.eskomTemplate) {
      eskomTemplateId = await newSiteTemplate(fleetPool, eskom[0].id, `${run}-eskom`, created);
    }

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

  return {
    ctx: () => {
      if (!ctx) throw new Error("F3.73: the site-layout harness has not run its beforeAll.");
      return ctx;
    },
    eskomTemplateId: () => eskomTemplateId,
  };
}
