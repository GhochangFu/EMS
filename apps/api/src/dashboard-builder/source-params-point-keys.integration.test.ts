import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { DashboardTemplatesService } from "../admin/dashboard-templates/dashboard-templates.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { VocabulariesService } from "../vocabularies/vocabularies.service";
import { DashboardsService } from "./dashboards.service";
import {
  changeFromStoredLiveRoleToInactiveRoleIs400,
  resaveOfStoredRetiredBalanceRoleStores,
  resaveOfStoredRetiredPointKeyStores,
  retiredPointKeyStoredOnlyAsARoleIs400,
  retiredPointKeyStoredOnlyElsewhereIs400,
  retiredRoleStoredOnlyElsewhereIs400,
  tileBinding,
  draftWithUnknownBalanceRoleRefusesToPublish,
  inactiveBalanceRoleIs400,
  seededBalanceRoleStoresItsParams,
  unknownBalanceRoleIs400NamingIt,
  draftWithSeededCodePublishes,
  draftWithUnknownCodeRefusesToPublish,
  inactiveCodeIs400,
  seededCodeStoresItsParams,
  unknownCodeIs400NamingIt,
} from "./source-params-point-keys.integration.spec";

/**
 * `E4.2` U3 — Vitest entry point. Assertions live in the sibling `.integration.spec.ts`
 * (ADR 0014); this file owns the database lifecycle, the per-run rows, and cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "E4.2",
  label: "a catalog binding's pointKey is checked against bms.point_keys at the write",
  because:
    "whether an unknown or inactive code is refused, and whether a seeded one stores, are facts " +
    "about a real bms.point_keys — a fake db proves only that the SELECT was issued.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const DASHBOARD_SLUG = `e42-u3-${RUN}`;
const UNKNOWN_CODE = `e42_nope_${RUN}`;
const INACTIVE_CODE = `e42_off_${RUN}`;
const DRAFT_CODE_BAD = `e42-u3-bad-${RUN}`;
const DRAFT_CODE_GOOD = `e42-u3-good-${RUN}`;
// `E4.3` U4 — a per-run inactive balance role and a draft binding an unknown one.
const INACTIVE_ROLE = `e43_off_${RUN}`;
const DRAFT_CODE_ROLE = `e43-u4-role-${RUN}`;
// Post-merge sweep M1 — a role and a point key that are live when a dashboard stores them and
// retired before it is saved again, and three dashboards that each carry stored sources.
const RETIRED_ROLE = `e43_ret_${RUN}`;
const RETIRED_KEY = `e43_ret_${RUN}`;
const ROLE_DASHBOARD_SLUG = `e43-m1-role-${RUN}`;
const KEY_DASHBOARD_SLUG = `e43-m1-key-${RUN}`;
const LIVE_DASHBOARD_SLUG = `e43-m1-live-${RUN}`;

const draftContent = (pointKey: string, balanceRole?: string) => ({
  widgets: [
    {
      key: "tile",
      title: "E4.2 U3",
      gridX: 0,
      gridY: 0,
      gridW: 2,
      gridH: 4,
      bindings: [],
      sources: [
        {
          catalogKey: "sustainability.total",
          params: { pointKey, aggregate: "sum", ...(balanceRole === undefined ? {} : { balanceRole }) },
          sortOrder: 0,
        },
      ],
      widgetType: "value_tile",
      config: {},
    },
  ],
});

describe.skipIf(!connectionString)("E4.2 U3 — pointKey verified at the binding write", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetDb: BmsDb;
  let eskomOrgId: string;
  let dashboardId: string;
  let badDraftId: string;
  let goodDraftId: string;
  let roleDraftId: string;
  let roleDashboardId: string;
  let keyDashboardId: string;
  let liveDashboardId: string;
  const actor = jwtFor(SEEDED.globalAdmin, "admin");

  const makeServices = () => {
    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    return {
      dashboards: new DashboardsService(tenantDb, fleetDb, accessControl, audit),
      templates: new DashboardTemplatesService(
        fleetDb,
        tenantDb,
        accessControl,
        audit,
        new VocabulariesService(fleetDb),
      ),
    };
  };

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "E4.2");
    superuserPool = await openIntegrationPool(
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
    fleetDb = createDb(fleetPool);

    const org = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
    );
    eskomOrgId = org.rows[0]?.id ?? "";
    if (!eskomOrgId) throw new Error("E4.2: ESKOM organization not found — run pnpm db:seed");

    // An organization-wide dashboard, so the global admin's `canManageDashboard` arm is the
    // plain one and nothing about scope is under test here.
    const dashboard = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, 'E4.2 U3 fixture')
       RETURNING id`,
      [eskomOrgId, DASHBOARD_SLUG],
    );
    dashboardId = dashboard.rows[0]?.id ?? "";
    if (!dashboardId) throw new Error("E4.2: dashboard insert returned no id");

    // The inactive row is per-run: the rule is ACTIVE, and only a row that exists with
    // `active = false` distinguishes "inactive is refused" from "absent is refused".
    await superuserPool.query(
      `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, 'E4.2 U3 inactive', false)`,
      [INACTIVE_CODE],
    );

    const drafts = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status, content)
       VALUES ($1, $2, 1, 'E4.2 U3 bad draft', 'sustainability', 'draft', $3),
              ($1, $4, 1, 'E4.2 U3 good draft', 'sustainability', 'draft', $5)
       RETURNING id`,
      [
        eskomOrgId,
        DRAFT_CODE_BAD,
        JSON.stringify(draftContent(UNKNOWN_CODE)),
        DRAFT_CODE_GOOD,
        JSON.stringify(draftContent("kl_today")),
      ],
    );
    badDraftId = drafts.rows[0]?.id ?? "";
    goodDraftId = drafts.rows[1]?.id ?? "";
    if (!badDraftId || !goodDraftId) throw new Error("E4.2: draft insert returned no ids");

    // `E4.3` U4 — the inactive role is per-run for the reason the inactive point key is: only a
    // row that exists with `active = false` tells "inactive is refused" from "absent is refused".
    await superuserPool.query(
      `INSERT INTO bms.water_balance_roles (code, label, active) VALUES ($1, 'E4.3 U4 inactive', false)`,
      [INACTIVE_ROLE],
    );
    const roleDraft = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.dashboard_templates (organization_id, code, version, name, section, status, content)
       VALUES ($1, $2, 1, 'E4.3 U4 role draft', 'sustainability', 'draft', $3)
       RETURNING id`,
      [eskomOrgId, DRAFT_CODE_ROLE, JSON.stringify(draftContent("kl_today", "nope"))],
    );
    roleDraftId = roleDraft.rows[0]?.id ?? "";
    if (!roleDraftId) throw new Error("E4.3: role draft insert returned no id");

    // Post-merge sweep M1 — store the retired-to-be values through the service while they are
    // live, then retire them, so the stored params are exactly what a real author would carry.
    await superuserPool.query(
      `INSERT INTO bms.water_balance_roles (code, label, active) VALUES ($1, 'E4.3 M1 retired', true)`,
      [RETIRED_ROLE],
    );
    await superuserPool.query(
      `INSERT INTO bms.point_keys (code, name, active) VALUES ($1, 'E4.3 M1 retired', true)`,
      [RETIRED_KEY],
    );
    const more = await superuserPool.query<{ id: string; slug: string }>(
      `INSERT INTO bms.dashboards (organization_id, slug, name)
       VALUES ($1, $2, 'E4.3 M1 fixture'), ($1, $3, 'E4.3 M1 fixture'), ($1, $4, 'E4.3 M1 fixture')
       RETURNING id, slug`,
      [eskomOrgId, ROLE_DASHBOARD_SLUG, KEY_DASHBOARD_SLUG, LIVE_DASHBOARD_SLUG],
    );
    const idOf = (slug: string) => more.rows.find((row) => row.slug === slug)?.id ?? "";
    roleDashboardId = idOf(ROLE_DASHBOARD_SLUG);
    keyDashboardId = idOf(KEY_DASHBOARD_SLUG);
    liveDashboardId = idOf(LIVE_DASHBOARD_SLUG);
    if (!roleDashboardId || !keyDashboardId || !liveDashboardId) {
      throw new Error("E4.3 M1: dashboard insert returned no ids");
    }
    const { dashboards } = makeServices();
    await dashboards.putWidgets(actor, roleDashboardId, tileBinding("kl_today", RETIRED_ROLE));
    await dashboards.putWidgets(actor, keyDashboardId, tileBinding(RETIRED_KEY));
    await dashboards.putWidgets(actor, liveDashboardId, tileBinding("kl_today", "intake"));
    await superuserPool.query(`UPDATE bms.water_balance_roles SET active = false WHERE code = $1`, [
      RETIRED_ROLE,
    ]);
    await superuserPool.query(`UPDATE bms.point_keys SET active = false WHERE code = $1`, [RETIRED_KEY]);
  }, 60_000);

  afterAll(async () => {
    const dashboardIds = [dashboardId, roleDashboardId, keyDashboardId, liveDashboardId].filter(Boolean);
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    const draftIds = [badDraftId, goodDraftId, roleDraftId].filter(Boolean);
    if (draftIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [draftIds]);
      await superuserPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [draftIds]);
    }
    await superuserPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [INACTIVE_CODE]);
    await superuserPool.query(`DELETE FROM bms.water_balance_roles WHERE code = ANY($1::text[])`, [
      [INACTIVE_ROLE, RETIRED_ROLE],
    ]);
    await superuserPool.query(`DELETE FROM bms.point_keys WHERE code = $1`, [RETIRED_KEY]);
    await Promise.all([fleetPool.end(), superuserPool.end(), tenantPool.end(), authPool.end()]);
  });

  it("refuses an unknown code with a 400 naming it", async () => {
    await unknownCodeIs400NamingIt(makeServices().dashboards, actor, dashboardId, UNKNOWN_CODE);
  });

  it("refuses a code whose catalog row is active = false", async () => {
    await inactiveCodeIs400(makeServices().dashboards, actor, dashboardId, INACTIVE_CODE);
  });

  it("stores a seeded code and its params (control)", async () => {
    await seededCodeStoresItsParams(makeServices().dashboards, fleetDb, actor, dashboardId);
  });

  it("refuses to publish a draft whose source names an unknown code", async () => {
    await draftWithUnknownCodeRefusesToPublish(makeServices().templates, actor, badDraftId, UNKNOWN_CODE);
  });

  it("publishes the same draft shape with kl_today (control)", async () => {
    await draftWithSeededCodePublishes(makeServices().templates, actor, goodDraftId);
  });

  it("refuses an unknown balanceRole with a 400 naming it", async () => {
    await unknownBalanceRoleIs400NamingIt(makeServices().dashboards, actor, dashboardId);
  });

  it("refuses a balanceRole whose vocabulary row is active = false", async () => {
    await inactiveBalanceRoleIs400(makeServices().dashboards, actor, dashboardId, INACTIVE_ROLE);
  });

  it("stores a seeded balanceRole and its params (control)", async () => {
    await seededBalanceRoleStoresItsParams(makeServices().dashboards, actor, dashboardId);
  });

  it("refuses to publish a draft whose source names an unknown balanceRole", async () => {
    await draftWithUnknownBalanceRoleRefusesToPublish(makeServices().templates, actor, roleDraftId);
  });

  it("stores a re-save that re-sends a stored balanceRole retired since (M1)", async () => {
    await resaveOfStoredRetiredBalanceRoleStores(makeServices().dashboards, actor, roleDashboardId, RETIRED_ROLE);
  });

  it("stores a re-save that re-sends a stored pointKey retired since (M1)", async () => {
    await resaveOfStoredRetiredPointKeyStores(makeServices().dashboards, actor, keyDashboardId, RETIRED_KEY);
  });

  it("still refuses an unknown balanceRole on a dashboard carrying stored sources (M1 control)", async () => {
    await unknownBalanceRoleIs400NamingIt(makeServices().dashboards, actor, roleDashboardId);
  });

  it("still refuses an unknown pointKey on a dashboard carrying stored sources (M1 control)", async () => {
    await unknownCodeIs400NamingIt(makeServices().dashboards, actor, keyDashboardId, UNKNOWN_CODE);
  });

  it("refuses a change from a stored live balanceRole to an inactive one (M1 control)", async () => {
    await changeFromStoredLiveRoleToInactiveRoleIs400(
      makeServices().dashboards,
      actor,
      liveDashboardId,
      INACTIVE_ROLE,
    );
  });

  it("refuses a retired balanceRole that only another dashboard stores (F1 control)", async () => {
    await retiredRoleStoredOnlyElsewhereIs400(makeServices().dashboards, actor, liveDashboardId, RETIRED_ROLE);
  });

  it("refuses a retired pointKey that only another dashboard stores (F1 control)", async () => {
    await retiredPointKeyStoredOnlyElsewhereIs400(makeServices().dashboards, actor, liveDashboardId, RETIRED_KEY);
  });

  it("refuses a retired pointKey this dashboard stores only as a balanceRole (F1 control)", async () => {
    // RETIRED_KEY and RETIRED_ROLE are the same string; roleDashboardId stores it as a role only.
    await retiredPointKeyStoredOnlyAsARoleIs400(makeServices().dashboards, actor, roleDashboardId, RETIRED_KEY);
  });
});
