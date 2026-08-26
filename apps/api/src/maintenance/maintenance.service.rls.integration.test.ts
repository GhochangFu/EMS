import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assets, createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { MaintenanceService } from "./maintenance.service";
import {
  assertConvertStampsAndAdvancesUnderRealRls,
  assertCreateStampsOrgAndActorUnderRealRls,
  assertDeactivateFlipsScheduleAndTemplateUnderRealRls,
  type MaintenanceRlsFixtures,
} from "./maintenance.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds one asset in a
 * real organization, then drives `MaintenanceService` writes with a real
 * `bms_tenant` connection: a create that must stamp the template's and
 * schedule's org, a deactivate that must flip both rows under `FORCE`, and a
 * convert that must stamp the work order + history and advance `next_due_at`.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "MaintenanceService org stamping and no-silent-no-op under real, non-owner roles",
  because:
    "The four maintenance write tables gain organization_id (0046) and a FORCEd policy (0047). " +
    "Constructing MaintenanceService with a real bms_tenant connection is the only proof its " +
    "writes stamp organization_id under withTenant — rather than passing because the owner " +
    "connection bypasses RLS — and that updateSchedule's template flip and convertToWorkOrder's " +
    "next_due_at advance actually land instead of silently affecting zero rows under FORCE.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

const RUN = Date.now();
const PREFIX = "E71B-MAINT-";

describe.skipIf(!connectionString)("E7.1b — MaintenanceService under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: MaintenanceRlsFixtures;
  const createdScheduleIds: string[] = [];
  const createdTemplateIds: string[] = [];
  const createdWorkOrderIds: string[] = [];
  let assetId: string;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    const organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.locations WHERE organization_id = $1 AND active = true LIMIT 1",
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s org has no active location — run pnpm db:seed.`);
    }
    const locationId = loc.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    // Seed on the fleet (BYPASSRLS) pool: assets are not policied until 0047, so
    // no GUC is needed to insert one. The maintenance writes under test are what
    // must run under a real bms_tenant connection.
    const fleetDb = createDb(ownerPool);
    const [asset] = await fleetDb
      .insert(assets)
      .values({
        organizationId,
        code: `${PREFIX}ASSET-${RUN}`,
        name: "E7.1b maintenance RLS asset",
        siteName: "E7.1b Site",
        locationId,
        domain,
        active: true,
      })
      .returning({ id: assets.id });
    assetId = asset.id;

    ctx = {
      service: new MaintenanceService(fleetDb, createDb(tenantPool)),
      ownerPool,
      organizationId,
      assetId,
      scopedActor: {
        sub: "00000000-0000-4000-8000-0000000000b1",
        email: ORGANIZATION_ADMIN_EMAIL,
      },
      createdScheduleIds,
      createdTemplateIds,
      createdWorkOrderIds,
    };
  });

  afterAll(async () => {
    if (ownerPool) {
      if (createdWorkOrderIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'work_order' AND entity_id = ANY($1)`,
          [createdWorkOrderIds],
        );
      }
      if (createdScheduleIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log WHERE entity_type = 'maintenance_schedule' AND entity_id = ANY($1)`,
          [createdScheduleIds],
        );
        await ownerPool.query(
          `DELETE FROM bms.maintenance_history WHERE schedule_id = ANY($1)`,
          [createdScheduleIds],
        );
      }
      if (createdWorkOrderIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.work_orders WHERE id = ANY($1)`, [
          createdWorkOrderIds,
        ]);
      }
      if (createdScheduleIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.maintenance_schedules WHERE id = ANY($1)`, [
          createdScheduleIds,
        ]);
      }
      if (createdTemplateIds.length > 0) {
        await ownerPool.query(
          `DELETE FROM bms.maintenance_task_templates WHERE id = ANY($1)`,
          [createdTemplateIds],
        );
      }
      if (assetId) {
        await ownerPool.query(`DELETE FROM bms.assets WHERE id = $1`, [assetId]);
      }
    }
    await Promise.all([ownerPool, tenantPool].filter(Boolean).map((p) => p.end()));
  });

  it("stamps template.org and schedule.org from the asset and resolves a non-NULL actor", async () => {
    await assertCreateStampsOrgAndActorUnderRealRls(ctx);
  });

  it("flips both the schedule and its template on deactivate, not a silent no-op", async () => {
    await assertDeactivateFlipsScheduleAndTemplateUnderRealRls(ctx);
  });

  it("stamps the work order + history and advances next_due_at on convert", async () => {
    await assertConvertStampsAndAdvancesUnderRealRls(ctx);
  });
});
