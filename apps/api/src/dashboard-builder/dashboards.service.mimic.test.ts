import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { DashboardsService } from "./dashboards.service";
import { assertMimicWidgetSavesAndReadsBackOnAGroupDashboard } from "./dashboards.service.mimic.spec";

/**
 * `F3.32` U3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle, its own per-run fixture, and cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F3.32",
  label: "DashboardsService — a mimic widget saves and reads back on a real asset-group dashboard",
  because:
    "whether a mimic widget actually persists, and whether a separate fleet connection sees it " +
    "committed, are facts about a real connection and real RLS, not something a fake db can prove.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const GROUP_CODE = `f332-mimic-grp-${RUN}`;
const DASHBOARD_SLUG = `f332-mimic-dash-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.32 U3 — DashboardsService.putWidgets saves and reads back a mimic widget on a group dashboard",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;

    let eskomOrgId: string;
    let eskomGroupId: string;
    let dashboardId: string;

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F3.32");
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.32",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.32",
      );
      fleetDb = createDb(ownerPool);

      const eskom = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
      );
      eskomOrgId = eskom.rows[0]?.id ?? "";
      if (!eskomOrgId) {
        throw new Error("F3.32: ESKOM organization not found — run pnpm db:seed");
      }

      // F4.53: the OLDEST row is a seeded one — the only one no concurrent suite can delete out
      // from under this fixture while the run is in progress.
      const location = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [eskomOrgId],
      );
      const locationId = location.rows[0]?.id;
      if (!locationId) {
        throw new Error("F3.32: ESKOM has no location — run pnpm db:seed");
      }

      const group = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, 'F3.32 mimic write fixture') RETURNING id`,
        [eskomOrgId, locationId, GROUP_CODE],
      );
      eskomGroupId = group.rows[0]?.id ?? "";
      if (!eskomGroupId) {
        throw new Error("F3.32: could not create this run's asset group");
      }
    }, 60_000);

    afterAll(async () => {
      if (dashboardId) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = $1`, [dashboardId]);
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = $1`, [dashboardId]);
      }
      if (eskomGroupId) {
        await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [eskomGroupId]);
      }
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("saves a mimic widget on a group-scoped dashboard, and a separate connection reads it back", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const created = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: DASHBOARD_SLUG,
        name: "F3.32 mimic write proof",
        assetGroupId: eskomGroupId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardId = created.id;

      await assertMimicWidgetSavesAndReadsBackOnAGroupDashboard(service, fleetDb, globalAdmin, created.id);
    }, 60_000);
  },
);
