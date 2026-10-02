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
  aGroupTabMimicNamingATabKeepsItsOwnTab,
  anAbsentTabKeyIsRefusedWithoutEchoingIt,
  anOverviewMimicNamingAGroupTabSavesAndResolves,
  anOverviewMimicNamingTheOverviewIsRefused,
  type MimicTabFixture,
} from "./dashboards.service.mimic-tab.integration.spec";
import { MimicNodesService } from "./mimic-nodes.service";

/**
 * `F3.74` Task 2.3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle, this run's fixture and its cleanup. Every case PUTs the same
 * two tabs onto one site dashboard and replaces its widgets.
 */
const connectionString = requireIntegrationDb({
  item: "F3.74",
  label: "DashboardsService — a mimic resolves through a named tab",
  because:
    "the guard reads the body's tabs but the proof that the saved tabKey resolves is the mimic-nodes " +
    "statement's named-tab join over the stored dashboard_tabs rows, a fact about a real database.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.74 — a mimic names its tab, against a real database", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  const dashboardIds: string[] = [];
  const groupIds: string[] = [];
  let f: MimicTabFixture;

  beforeAll(async () => {
    const url = connectionString as string;
    const POOL = { max: 2 } as const;
    fleetPool = await openIntegrationPool(url, "F3.74", POOL);
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.74", POOL);
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.74",
      POOL,
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.74",
      POOL,
    );
    const fleetDb = createDb(fleetPool);

    const org = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM'`);
    const organizationId = org.rows[0]?.id ?? "";
    // A seeded asset named by code (the fixture-isolation gate), never a positional read: the
    // Control Room's main breaker, at its own site.
    const site = await fleetPool.query<{ location_id: string; asset_id: string }>(
      `SELECT a.location_id, a.id AS asset_id FROM bms.assets a
       WHERE a.organization_id = $1 AND a.code = 'CR-Q1'`,
      [organizationId],
    );
    const here = site.rows[0]?.location_id;
    const mainBreakerAssetId = site.rows[0]?.asset_id;
    if (!organizationId || !here || !mainBreakerAssetId) {
      throw new Error("F3.74: ESKOM's seeded asset CR-Q1 not found — run pnpm db:seed");
    }
    const group = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
       VALUES ($1, $2, $3, 'F3.74 mimic-tab fixture') RETURNING id`,
      [organizationId, here, `f374-sld-${RUN}`],
    );
    const sldGroupId = group.rows[0]?.id ?? "";
    groupIds.push(sldGroupId);
    await fleetPool.query(
      `INSERT INTO bms.asset_group_members (asset_group_id, asset_id, role) VALUES ($1, $2, 'main-breaker')`,
      [sldGroupId, mainBreakerAssetId],
    );

    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
    const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
    const mimicNodes = new MimicNodesService(fleetDb, fleetPool, accessControl);
    const actor = jwtFor(SEEDED.globalAdmin, "admin");
    const created = await service.create(actor, {
      organizationId,
      slug: `f374-mimic-tab-${RUN}`,
      name: "F3.74 mimic-tab fixture",
      locationId: here,
    } as Parameters<DashboardsService["create"]>[1]);
    dashboardIds.push(created.id);

    f = { service, mimicNodes, actor, organizationId, dashboardId: created.id, sldGroupId, mainBreakerAssetId };
  }, 60_000);

  afterAll(async () => {
    // Dashboards first: they cascade their tabs, whose group FK is ON DELETE RESTRICT.
    if (dashboardIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
      await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
    }
    if (groupIds.length > 0) {
      await superuserPool.query(`DELETE FROM bms.asset_group_members WHERE asset_group_id = ANY($1::uuid[])`, [groupIds]);
      await superuserPool.query(`DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])`, [groupIds]);
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("an Overview mimic naming a group tab saves and mimic-nodes resolves it there", async () => {
    await anOverviewMimicNamingAGroupTabSavesAndResolves(f);
  }, 60_000);

  it("an Overview mimic naming the Overview is a 400 with MIMIC_TAB_MESSAGE", async () => {
    await anOverviewMimicNamingTheOverviewIsRefused(f);
  }, 60_000);

  it("an Overview mimic naming an absent tab is a 400 that never echoes the key", async () => {
    await anAbsentTabKeyIsRefusedWithoutEchoingIt(f);
  }, 60_000);

  it("a group-tab mimic that also names a tab keeps its own tab", async () => {
    await aGroupTabMimicNamingATabKeepsItsOwnTab(f);
  }, 60_000);
});
