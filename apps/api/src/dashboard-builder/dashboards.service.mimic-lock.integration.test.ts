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
import { DashboardsService } from "./dashboards.service";
import { assertSaveWaitsForAConcurrentDeleteThenRefuses } from "./dashboards.service.mimic-lock.integration.spec";

/**
 * `F3.32c` U7 — Vitest entry point for the widget-save / layout-delete lock. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the pools, the fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id** — never a broad `DELETE` (the `F3.37`
 * data-loss finding). The dashboard's widgets cascade; the group goes after the dashboard.
 */
const connectionString = requireIntegrationDb({
  item: "F3.32c",
  label: "DashboardsService widget save against a concurrent mimic layout delete",
  because:
    "whether a save waits for a delete that holds the layout is a fact about real row locks " +
    "on a real connection; a fake db has no lock to wait on.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.32c — a widget save waits for a concurrent layout delete", () => {
  let fleetPool: pg.Pool;
  let superuserPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetDb: BmsDb;
  let eskomOrgId = "";
  let eskomLocationId = "";
  let assetGroupId: string | undefined;
  const dashboardIds: string[] = [];
  const layoutIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "F3.32c");
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.32c");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.32c",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.32c",
    );
    fleetDb = createDb(fleetPool);

    const eskom = await fleetPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`);
    eskomOrgId = eskom.rows[0]?.id ?? "";
    if (!eskomOrgId) {
      throw new Error("F3.32c: organization ESKOM not found — run pnpm db:seed");
    }
    // F4.53: the OLDEST row is a seeded one, which no concurrent suite deletes.
    const location = await fleetPool.query<{ id: string }>(
      `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
      [eskomOrgId],
    );
    eskomLocationId = location.rows[0]?.id ?? "";
    if (!eskomLocationId) {
      throw new Error("F3.32c: ESKOM has no location — run pnpm db:seed");
    }
    // `F4.71` U6 — this run's own group, never one adopted by position.
    const group = await fleetPool.query<{ id: string }>(
      `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [eskomOrgId, eskomLocationId, `F332C-LOCK-${RUN}`, "F3.32c lock fixture group"],
    );
    assetGroupId = group.rows[0]?.id;
    if (!assetGroupId) {
      throw new Error("F3.32c: could not create this run's ESKOM asset group");
    }
  }, 60_000);

  afterAll(async () => {
    if (superuserPool) {
      if (dashboardIds.length > 0) {
        await superuserPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
        await superuserPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
      }
      if (layoutIds.length > 0) {
        await superuserPool.query(`DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])`, [layoutIds]);
      }
      if (assetGroupId) {
        await superuserPool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [assetGroupId]);
      }
    }
    await Promise.all([fleetPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("a save naming a layout a delete holds waits, then answers 400 and writes no row", async () => {
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
    const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
    const actor = jwtFor(SEEDED.globalAdmin, "admin");

    const dashboard = await service.create(actor, {
      organizationId: eskomOrgId,
      slug: `f332c-lock-${RUN}`,
      name: "F3.32c lock proof",
      assetGroupId,
    } as Parameters<DashboardsService["create"]>[1]);
    dashboardIds.push(dashboard.id);

    const layout = await superuserPool.query<{ id: string }>(
      `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
       VALUES ($1, 'F3.32c lock fixture', $2, 60, 40) RETURNING id`,
      [eskomOrgId, `f332c-lock-${RUN}`],
    );
    const layoutId = layout.rows[0]?.id as string;
    layoutIds.push(layoutId);

    await assertSaveWaitsForAConcurrentDeleteThenRefuses({
      service,
      superuserPool,
      actor,
      dashboardId: dashboard.id,
      layoutId,
    });
  }, 60_000);
});
