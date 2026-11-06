import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";
import { ORGANIZATION_STANDARD_TEMPLATE } from "@bms/shared/site-templates";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { asRole } from "./role-urls";
import { jwtFor, primeSeededSubjects, rememberSubject, SEEDED } from "./seeded-subjects";

/**
 * `F4.317` PR 4 — the shared fixture for the organization-layout suites (the view-access
 * predicate, `OrganizationLayoutService` and the narrow dashboard grant). Each wrapper calls
 * `useOrganizationLayoutHarness` inside its own `describe` and gets its own pools, its own two
 * per-run organizations and its own cleanup, so the suites may run in parallel workers: the
 * pointer table is keyed by `organization_id`, and two suites writing one seeded organization's
 * row would race on it.
 *
 * **Two organizations, A and B, coded `ZF4317OL-<run>-A/B`** (`Z` sorts after every seeded code,
 * so a positional organization read, `F4.70`, never adopts one). In A: active locations A1 and A2,
 * asset `a1` at A1 and `a2` at A2, an asset group at A1 holding `a1`, and a published
 * `organization` template carrying `ORGANIZATION_STANDARD_TEMPLATE`'s content. In B: location B1,
 * asset `b1`, and B's own published template. Users: an `organization_admin` of A, a
 * `location_admin` of A1, an `asset_group_admin` of A's group, and a `location_admin` of B1; the
 * global admin is the seeded one.
 *
 * Lives in `src/testing/` and does not import `integration-db-gate` (the `site-layout-harness.ts`
 * reasons): each wrapper calls `requireIntegrationDb(ORGANIZATION_LAYOUT_DB_GATE)` and hands the
 * harness its connection string and the gate's pool openers.
 */
export const ORGANIZATION_LAYOUT_DB_GATE = {
  item: "F4.317",
  label: "the organization Control Room layout against real, non-owner roles",
  because:
    "the view row's RLS, the copy's one withTenant transaction, the location admin's grant on " +
    "one organization-wide dashboard and the strip's values over each caller's readable assets " +
    "are facts about real rows, real grants and real policies that a mock cannot show.",
};

/** What the wrapper's gate supplies: the fleet URL and the gate's pool openers, bound. */
export type OrganizationLayoutDbAccess = {
  connectionString: string | undefined;
  openPool: (url: string) => Promise<pg.Pool>;
  superuserUrl: (url: string) => string;
};

export type OrganizationLayoutFixture = {
  readonly run: string;
  readonly fleetPool: pg.Pool;
  readonly superuserPool: pg.Pool;
  readonly fleetDb: BmsDb;
  readonly tenantDb: BmsDb;
  readonly accessControl: AccessControlService;
  readonly audit: MasterDataAuditService;
  readonly orgA: string;
  readonly orgB: string;
  readonly locA1: string;
  readonly locA2: string;
  readonly locB1: string;
  readonly assetA1: string;
  readonly assetA2: string;
  readonly assetB1: string;
  readonly templateA: string;
  readonly templateB: string;
  readonly jwt: {
    readonly admin: JwtPayload;
    readonly orgAdminA: JwtPayload;
    readonly locAdminA: JwtPayload;
    readonly groupAdminA: JwtPayload;
    readonly locAdminB: JwtPayload;
  };
};

const PREFIX = "ZF4317OL-";

/** Child-first removal of everything under the given organizations and users. */
async function removeFixtures(superuserPool: pg.Pool, sel: { orgs: string; users: string }): Promise<void> {
  const q = (text: string) => superuserPool.query(text);
  await q(`DELETE FROM bms.audit_log WHERE organization_id IN (${sel.orgs}) OR actor_id IN (${sel.users})`);
  await q(`DELETE FROM bms.organization_control_room_views WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.dashboards WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.dashboard_templates WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.user_location_access WHERE user_id IN (${sel.users})`);
  await q(`DELETE FROM bms.user_organization_access WHERE user_id IN (${sel.users})`);
  await q(`DELETE FROM bms.user_asset_group_access WHERE user_id IN (${sel.users})`);
  await q(`DELETE FROM bms.users WHERE id IN (${sel.users})`);
  // ADR 0024: a constant filter on the segmentby column, never a subquery (it would decompress
  // every batch); the ids are resolved first and bound.
  const { rows: assetRows } = await q(`SELECT id FROM bms.assets WHERE organization_id IN (${sel.orgs})`);
  const assetIds = assetRows.map((row: { id: string }) => row.id);
  if (assetIds.length > 0) {
    await superuserPool.query(`DELETE FROM telemetry.point_values WHERE asset_id = ANY($1::uuid[])`, [assetIds]);
  }
  await q(
    `DELETE FROM bms.asset_group_members WHERE asset_group_id IN
       (SELECT id FROM bms.asset_groups WHERE organization_id IN (${sel.orgs}))`,
  );
  await q(`DELETE FROM bms.asset_groups WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.assets WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.locations WHERE organization_id IN (${sel.orgs})`);
  await q(`DELETE FROM bms.organizations WHERE id IN (${sel.orgs})`);
}

/** Reaps a killed run's fixtures: older than 30 minutes, so a parallel live run is out of reach. */
async function sweepStaleRuns(superuserPool: pg.Pool): Promise<void> {
  const old = "created_at < now() - interval '30 minutes'";
  try {
    await removeFixtures(superuserPool, {
      orgs: `SELECT id FROM bms.organizations WHERE code LIKE '${PREFIX}%' AND ${old}`,
      users: `SELECT id FROM bms.users WHERE email LIKE 'zf4317ol-%' AND ${old}`,
    });
  } catch (err) {
    process.stderr.write(
      "[F4.317] could not sweep stale organization-layout fixtures: " +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

/** Registers the `beforeAll`/`afterAll` pair on the calling `describe`; `tag` goes into the run id. */
export function useOrganizationLayoutHarness(
  db: OrganizationLayoutDbAccess,
  opts: { tag: string },
): () => OrganizationLayoutFixture {
  let fleetPool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let superuserPool: pg.Pool | undefined;
  let fixture: OrganizationLayoutFixture | undefined;
  const orgs: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    const url = db.connectionString as string;
    fleetPool = await db.openPool(url);
    await primeSeededSubjects(fleetPool);
    authPool = await db.openPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"));
    tenantPool = await db.openPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"));
    superuserPool = await db.openPool(db.superuserUrl(url));
    const su = superuserPool;
    await sweepStaleRuns(su);

    const run = `${randomUUID().replace(/-/g, "").slice(0, 8)}${opts.tag}`;
    const one = async (text: string, params: unknown[]): Promise<string> => {
      const { rows } = await su.query<{ id: string }>(text, params);
      const id = rows[0]?.id;
      if (!id) throw new Error(`F4.317 harness: no id returned by ${text.slice(0, 40)}`);
      return id;
    };
    const { rows: domains } = await su.query<{ code: string }>(`SELECT code FROM bms.asset_domains ORDER BY code LIMIT 1`);
    const domain = domains[0]?.code ?? null;

    const org = async (tag: string): Promise<string> => {
      const id = await one(
        `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id`,
        [`${PREFIX}${run}-${tag}`, `F4.317 org ${tag} ${run}`],
      );
      orgs.push(id);
      return id;
    };
    const location = (orgId: string, tag: string): Promise<string> =>
      one(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude, active)
         VALUES ($1, $2, $3, $4, 'csmoc', 0, 0, true) RETURNING id`,
        [orgId, `${PREFIX}${run}-${tag}`, `zf4317ol-${run}-${tag}`.toLowerCase(), `F4.317 site ${tag} ${run}`],
      );
    const asset = (orgId: string, locationId: string, tag: string): Promise<string> =>
      one(
        `INSERT INTO bms.assets (organization_id, location_id, code, name, site_name, domain)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [orgId, locationId, `${PREFIX}${run}-${tag}`, `F4.317 ${tag} ${run}`, `F4.317 ${tag}`, domain],
      );
    const template = (orgId: string, tag: string): Promise<string> =>
      one(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content, target, published_at)
         VALUES ($1, $2, 1, $3, 'organization', 'published', $4::jsonb, 'organization', now()) RETURNING id`,
        [
          orgId,
          `zf4317ol-${run}-${tag}`.toLowerCase(),
          `Organization strip ${tag} (F4.317 fixture)`,
          JSON.stringify(ORGANIZATION_STANDARD_TEMPLATE.content),
        ],
      );
    const user = async (tag: string, role: string, orgId: string): Promise<JwtPayload> => {
      const email = `zf4317ol-${run}-${tag}@integration.invalid`.toLowerCase();
      const id = await one(
        `INSERT INTO bms.users (email, display_name, role, organization_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, `F4.317 ${tag}`, role, orgId],
      );
      users.push(id);
      rememberSubject(email, id);
      return jwtFor(email, role as JwtPayload["role"]);
    };

    const orgA = await org("A");
    const orgB = await org("B");
    const locA1 = await location(orgA, "A1");
    const locA2 = await location(orgA, "A2");
    const locB1 = await location(orgB, "B1");
    const assetA1 = await asset(orgA, locA1, "a1");
    const assetA2 = await asset(orgA, locA2, "a2");
    const assetB1 = await asset(orgB, locB1, "b1");
    const groupA = await one(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, 'F4.317 group') RETURNING id`,
      [orgA, locA1, `zf4317ol-${run}-g`.toLowerCase()],
    );
    await su.query(`INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2)`, [groupA, assetA1]);
    const templateA = await template(orgA, "ta");
    const templateB = await template(orgB, "tb");

    const orgAdminA = await user("orgadmin-a", "organization_admin", orgA);
    await su.query(`INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)`, [orgAdminA.sub, orgA]);
    const locAdminA = await user("locadmin-a", "location_admin", orgA);
    await su.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [locAdminA.sub, locA1]);
    const groupAdminA = await user("groupadmin-a", "asset_group_admin", orgA);
    await su.query(`INSERT INTO bms.user_asset_group_access (user_id, asset_group_id) VALUES ($1, $2)`, [groupAdminA.sub, groupA]);
    const locAdminB = await user("locadmin-b", "location_admin", orgB);
    await su.query(`INSERT INTO bms.user_location_access (user_id, location_id) VALUES ($1, $2)`, [locAdminB.sub, locB1]);

    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    fixture = {
      run,
      fleetPool,
      superuserPool: su,
      fleetDb,
      tenantDb,
      accessControl: new AccessControlService(createDb(authPool), fleetDb),
      audit: new MasterDataAuditService(tenantDb, fleetDb),
      orgA,
      orgB,
      locA1,
      locA2,
      locB1,
      assetA1,
      assetA2,
      assetB1,
      templateA,
      templateB,
      jwt: { admin: jwtFor(SEEDED.globalAdmin, "admin"), orgAdminA, locAdminA, groupAdminA, locAdminB },
    };
  });

  afterAll(async () => {
    if (superuserPool && orgs.length > 0) {
      // Database-generated uuids, so a literal array is safe and each query needs no parameter.
      const ids = (list: string[]): string =>
        list.length === 0 ? "SELECT NULL::uuid" : `SELECT unnest('{${list.join(",")}}'::uuid[])`;
      await removeFixtures(superuserPool, { orgs: ids(orgs), users: ids(users) });
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end(), superuserPool?.end()]);
  });

  return () => {
    if (!fixture) throw new Error("F4.317: the organization-layout harness has not run its beforeAll.");
    return fixture;
  };
}

/** An organization-wide dashboard in `organizationId` (both scope columns NULL), written as the superuser. */
export async function newOrganizationWideDashboard(fx: OrganizationLayoutFixture, organizationId: string, tag: string): Promise<string> {
  const { rows } = await fx.superuserPool.query<{ id: string }>(
    `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, `zf4317ol-${fx.run}-${tag}`.toLowerCase(), `F4.317 ${tag}`],
  );
  return rows[0]?.id as string;
}

/** Writes (or replaces) `organizationId`'s pointer row, as the superuser. */
export async function pointOrganizationAt(
  fx: OrganizationLayoutFixture,
  organizationId: string,
  dashboardId: string | null,
): Promise<void> {
  await fx.superuserPool.query(
    `INSERT INTO bms.organization_control_room_views (organization_id, dashboard_id) VALUES ($1, $2)
     ON CONFLICT (organization_id) DO UPDATE SET dashboard_id = EXCLUDED.dashboard_id`,
    [organizationId, dashboardId],
  );
}

/** Removes `organizationId`'s pointer row, as the superuser. */
export async function clearOrganizationView(fx: OrganizationLayoutFixture, organizationId: string): Promise<void> {
  await fx.superuserPool.query(`DELETE FROM bms.organization_control_room_views WHERE organization_id = $1`, [
    organizationId,
  ]);
}

/** One sample on `assetId` now, so it reports inside the live window (`REPORTING_ASSETS_CTE_SQL`). */
export async function reportNow(fx: OrganizationLayoutFixture, assetId: string): Promise<void> {
  await fx.superuserPool.query(
    `INSERT INTO telemetry.point_values (time, asset_id, point_key, value) VALUES (now(), $1, 'kw', 1)`,
    [assetId],
  );
}
