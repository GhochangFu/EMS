import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";
import { sql } from "drizzle-orm";

import { assets, createDb, locations, workOrders } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { withTenant } from "../database/tenant-context";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects } from "../testing/seeded-subjects";
import { WorkOrdersService } from "./work-orders.service";
import {
  type AssigneeFixtures,
  createAcceptsAnActiveUserOfTheOrganization,
  createRefusesADisabledUserOfTheOrganization,
  createRefusesAGlobalAdmin,
  createRefusesAnUnknownIdWithTheSameSentence,
  createRefusesAUserOfAnotherOrganization,
  createWithoutAnAssigneeStaysOpen,
  updateAcceptsAnActiveUserOfTheOrganization,
  updateClearsTheAssigneeWithNull,
  updateRefusesADisabledUser,
  updateRefusesAUserOfAnotherOrganizationAndLeavesTheRow,
  updateWithoutAssignedToLeavesTheAssigneeUnchanged,
} from "./work-orders.assignee.integration.spec";

/**
 * `F4.285` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle. It seeds a location, an asset and a work order in org A under
 * `bms_tenant`, three users on the superuser pool (`bms_fleet` has no grant on `bms.users`),
 * and drives the work-order writers with a real `bms_tenant`/`bms_fleet` pair.
 */
const connectionString = requireIntegrationDb({
  item: "F4.285",
  label: "the work-order routes' assignee check against real, non-owner roles",
  because:
    "WorkOrdersService.create/updateStatus must refuse an assignedTo that is not an active user of the " +
    "work order's organization (ADR 0106 decision 6). The read runs inside the write's tenant transaction " +
    "under bms.users FORCE RLS, so only a real database with the deployment's roles shows it holds.",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F4.285",
  label: "the assignee fixture users",
  because: "Only the superuser inserts and deletes bms.users rows under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";

// Per-run fixture prefix (F4.65): randomUUID() sits in PREFIX's own declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "F4285-WO-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}-`;
const SUITE_START = new Date();
const LOCATION_CODE = `${PREFIX}LOC`;
const LOCATION_SLUG = `${PREFIX.toLowerCase()}loc`;
const ASSET_CODE = `${PREFIX}AS`;
const EMAIL_PREFIX = PREFIX.toLowerCase();

/**
 * Reaps rows a *killed* earlier run committed but never cleaned. Bounded by `created_at`: a
 * concurrent instance's rows are seconds old, so a half-hour-old row cannot belong to a run in
 * flight. Child-first (the FKs are NO ACTION). Non-fatal: per-run codes mean a stale row cannot
 * collide with this run's rows.
 */
async function sweepStaleRuns(fleet: pg.Pool, superuser: pg.Pool): Promise<void> {
  const staleFamily = `${FAMILY}%`;
  try {
    await fleet.query(
      `DELETE FROM bms.work_orders
        WHERE asset_id IN (
          SELECT id FROM bms.assets
           WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'
        )`,
      [staleFamily],
    );
    await fleet.query(
      `DELETE FROM bms.assets WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [staleFamily],
    );
    await fleet.query(
      `DELETE FROM bms.locations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`,
      [staleFamily],
    );
    await superuser.query(
      `DELETE FROM bms.users u
        WHERE u.email LIKE 'f4285-wo-%' AND u.created_at < now() - interval '30 minutes'
          AND NOT EXISTS (SELECT 1 FROM bms.work_orders w WHERE w.assigned_to = u.id)`,
    );
  } catch (err) {
    process.stderr.write(
      `[F4.285] could not sweep stale ${FAMILY} rows: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        "        Harmless for this run — fixture codes are per-run — but the rows stay.\n",
    );
  }
}

describe.skipIf(!connectionString)("F4.285 — the work-order routes refuse a bad assignee (ADR 0106 decision 6)", () => {
  let ownerPool: pg.Pool;
  let superPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let ctx: AssigneeFixtures;
  let actorUserId = "";
  let actor: Pick<JwtPayload, "sub" | "email">;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.285");
    superPool = await openIntegrationPool(superuserConnectionString as string, "F4.285");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.285",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.285",
    );
    await primeSeededSubjects(fleetPool);
    actor = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

    await sweepStaleRuns(ownerPool, superPool);

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`F4.285: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const orgA = org.rows[0].id;

    const usr = await ownerPool.query<{ id: string }>("SELECT id FROM bms.users WHERE email = $1 LIMIT 1", [
      ORGANIZATION_ADMIN_EMAIL,
    ]);
    if (!usr.rows[0]) throw new Error(`F4.285: ${ORGANIZATION_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);
    actorUserId = usr.rows[0].id;

    const admin = await superPool.query<{ id: string }>(
      "SELECT id FROM bms.users WHERE email = $1 AND organization_id IS NULL LIMIT 1",
      [GLOBAL_ADMIN_EMAIL],
    );
    if (!admin.rows[0]) throw new Error(`F4.285: ${GLOBAL_ADMIN_EMAIL} is not a seeded global admin — run pnpm db:seed.`);
    const globalAdminId = admin.rows[0].id;

    const orgB = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 ORDER BY created_at, code LIMIT 1",
      [orgA],
    );
    if (!orgB.rows[0]) throw new Error("F4.285: need a second seeded organization for the other-org refusal.");

    const dom = await ownerPool.query<{ code: string }>("SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1");
    if (!dom.rows[0]) throw new Error("F4.285: no active asset_domain — run pnpm db:seed.");
    const domain = dom.rows[0].code;

    const user = async (organizationId: string, name: string, disabled: boolean): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(
        `INSERT INTO bms.users (organization_id, email, display_name, role, disabled_at)
         VALUES ($1, $2, $3, 'operator', ${disabled ? "now()" : "NULL"}) RETURNING id`,
        [organizationId, `${EMAIL_PREFIX}${name}@integration.invalid`, `F4.285 ${name}`],
      );
      if (!rows[0]) throw new Error(`F4.285: user ${name} was not created`);
      return rows[0].id;
    };
    const activeA = await user(orgA, "active-a", false);
    const disabledA = await user(orgA, "disabled-a", true);
    const activeB = await user(orgB.rows[0].id, "active-b", false);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);

    let assetId = "";
    let workOrderId = "";
    await withTenant(tenantDb, orgA, async (tx) => {
      const [loc] = await tx
        .insert(locations)
        .values({
          organizationId: orgA,
          code: LOCATION_CODE,
          slug: LOCATION_SLUG,
          name: "F4.285 WO Location",
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
          organizationId: orgA,
          code: ASSET_CODE,
          name: "F4.285 WO Asset",
          siteName: "F4.285 Site",
          locationId: loc.id,
          domain,
          active: true,
        })
        .returning({ id: assets.id });
      assetId = asset.id;
      const [wo] = await tx
        .insert(workOrders)
        .values({ organizationId: orgA, assetId, title: `${PREFIX}update`, status: "open", priority: "medium" })
        .returning({ id: workOrders.id });
      workOrderId = wo.id;
    });

    ctx = {
      svc: new WorkOrdersService(fleetDb, tenantDb, new MasterDataAuditService(tenantDb, fleetDb)),
      actor,
      fleetPool,
      assetId,
      workOrderId,
      activeA,
      disabledA,
      activeB,
      globalAdminId,
      unknownId: randomUUID(),
      titlePrefix: PREFIX,
    };
  });

  afterAll(async () => {
    // Children first. audit_log has no FK, so it is cleared by this suite's actor in its window.
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
    // Users after the work orders that name them.
    await superPool?.query("DELETE FROM bms.users WHERE email LIKE $1", [`${EMAIL_PREFIX}%`]);
    await Promise.all([ownerPool, superPool, tenantPool, fleetPool].filter(Boolean).map((p) => p.end()));
  });

  it("create accepts an active user of the work order's organization", () =>
    createAcceptsAnActiveUserOfTheOrganization(ctx));
  it("create refuses a user of another organization", () => createRefusesAUserOfAnotherOrganization(ctx));
  it("create refuses a disabled user of the organization", () => createRefusesADisabledUserOfTheOrganization(ctx));
  it("create refuses a global admin (DC-A)", () => createRefusesAGlobalAdmin(ctx));
  it("create refuses an unknown id with the same sentence (DC-B)", () => createRefusesAnUnknownIdWithTheSameSentence(ctx));
  it("create without an assignee stays open", () => createWithoutAnAssigneeStaysOpen(ctx));
  it("update accepts an active user of the work order's organization", () =>
    updateAcceptsAnActiveUserOfTheOrganization(ctx));
  it("update refuses a user of another organization and leaves the row", () =>
    updateRefusesAUserOfAnotherOrganizationAndLeavesTheRow(ctx));
  it("update refuses a disabled user", () => updateRefusesADisabledUser(ctx));
  it("update clears the assignee with null (DC-D)", () => updateClearsTheAssigneeWithNull(ctx));
  it("update without assignedTo leaves the assignee unchanged (DC-D)", () =>
    updateWithoutAssignedToLeavesTheAssigneeUnchanged(ctx));
});
