import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { sql } from "drizzle-orm";

import { assets, createDb, locations } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { WorkOrdersService } from "./work-orders.service";
import {
  assertWorkOrderWritesStampOrgUnderRealRls,
  type WorkOrdersRlsFixtures,
} from "./work-orders.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It seeds a location and an
 * asset in one org through `bms_tenant`, then drives the work-orders writers
 * with a real `bms_tenant`/`bms_fleet` pair and proves each stamps or preserves
 * the org — the service's first test of any kind.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "work-orders write path against real, non-owner roles",
  because:
    "WorkOrdersService.create/updateStatus/reorder write work_orders, which gained organization_id " +
    "in 0046 and a FORCEd policy in 0047, and the service had no test at all. Constructing it with " +
    "real bms_tenant/bms_fleet connections is the only proof create stamps the asset's org, the " +
    "actor resolves on fleetDb rather than silently becoming NULL, and the tenant-wrapped update and " +
    "reorder leave the org intact — rather than passing because the owner connection bypasses RLS.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000007";

const RUN = Date.now();
const SUITE_START = new Date();
const PREFIX = "E71B-WO-";
const LOCATION_CODE = `${PREFIX}LOC-${RUN}`;
const LOCATION_SLUG = `e71b-wo-loc-${RUN}`;
const ASSET_CODE = `${PREFIX}AS-${RUN}`;

describe.skipIf(!connectionString)("E7.1b — work-orders writes stamp org under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: WorkOrdersRlsFixtures;
  let actorUserId = "";

  const actor: Pick<JwtPayload, "sub" | "email"> = {
    sub: SYNTHETIC_SUB,
    email: ORGANIZATION_ADMIN_EMAIL,
  };

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
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

    const usr = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.users WHERE email = $1 LIMIT 1",
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!usr.rows[0]) {
      throw new Error(`E7.1b: ${ORGANIZATION_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);
    }
    actorUserId = usr.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    const domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);

    // Seed the parents inside one tenant GUC. locations is policied (FORCE since
    // 0040) so the GUC = org lets its WITH CHECK pass; assets is not policied
    // until 0047 and ignores the GUC but still carries the org column.
    let assetId = "";
    await withTenant(tenantDb, organizationId, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId,
          code: LOCATION_CODE,
          slug: LOCATION_SLUG,
          name: "E7.1b WO Location",
          type: "smoc_campus",
          latitude: 0,
          longitude: 0,
          active: true,
          updatedAt: sql`now()`,
        })
        .returning({ id: locations.id });

      const [asset] = await tx
        .insert(assets)
        .values({
          organizationId,
          code: ASSET_CODE,
          name: "E7.1b WO Asset",
          siteName: "E7.1b Site",
          locationId: loc.id,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      assetId = asset.id;
    });

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb),
      ownerPool,
      organizationId,
      assetId,
      actorUserId,
    };
  });

  afterAll(async () => {
    // children first, on the BYPASSRLS fleet connection. audit_log has no FK, so
    // it is cleared by this suite's actor within its own time window.
    if (ownerPool) {
      if (actorUserId) {
        await ownerPool.query(
          `DELETE FROM bms.audit_log
            WHERE actor_id = $1 AND created_at >= $2 AND action LIKE 'work_order%'`,
          [actorUserId, SUITE_START],
        );
      }
      await ownerPool.query(
        `DELETE FROM bms.work_orders
          WHERE asset_id IN (SELECT id FROM bms.assets WHERE code LIKE $1)`,
        [`${PREFIX}%`],
      );
      await ownerPool.query(`DELETE FROM bms.assets WHERE code LIKE $1`, [`${PREFIX}%`]);
      await ownerPool.query(`DELETE FROM bms.locations WHERE code LIKE $1`, [`${PREFIX}%`]);
    }
    await Promise.all(
      [ownerPool, authPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
  });

  it("stamps the asset's org on create, resolves the actor, and preserves org on update/reorder", async () => {
    await assertWorkOrderWritesStampOrgUnderRealRls(ctx, actor);
  });
});
