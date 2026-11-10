import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { SEEDED, jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import { WorkOrderSlaPoliciesAdminController } from "./work-order-sla-policies.controller";
import {
  aGetWithNoRowsAnswersFourDefaults,
  aLocationAdminIsRefusedInItsOwnOrganization,
  aPutReplacesTheSetAndAuditsOnce,
  anOrganizationAdminOfBIsRefusedForA,
  anUnknownOrganizationIsNotFound,
  bsTenantSettingReadsNoneOfAsRows,
  type SlaPolicyFixtures,
} from "./work-order-sla-policies.integration.spec";
import { WorkOrderSlaPoliciesAdminService } from "./work-order-sla-policies.service";

/**
 * `E3.1` (ADR 0122 decision 3.2, plan T1.6) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the pools, the per-run organization A and
 * its cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "work-order SLA policy admin routes against real, non-owner roles",
  because:
    "the organization gate reads bms.users and the grant tables as bms_auth and bms_fleet, and the " +
    "policy table's FORCE row security only binds bms_tenant. A mocked database proves none of: the " +
    "organization admin of B is refused for A, a location admin is refused in its own organization, " +
    "and B's tenant setting reads none of A's rows.",
});

// Per-run fixture code (F4.65): randomUUID() sits in PREFIX's own declaration because the
// isolation invariant (tests/integration-fixture-isolation.test.ts) reads it literally.
const FAMILY = "E31-SLA-";
const PREFIX = `${FAMILY}${randomUUID().replace(/-/g, "").slice(0, 12)}`;

describe.skipIf(!connectionString)("E3.1 — work-order SLA policy admin routes under real RLS", () => {
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let ctx: SlaPolicyFixtures;
  const createdOrgIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E3.1",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E3.1",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E3.1",
    );
    await primeSeededSubjects(fleetPool);

    const orgB = await fleetPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        ORDER BY uoa.organization_id
        LIMIT 1`,
      [SEEDED.organizationAdmin],
    );
    const locationAdminOrg = await fleetPool.query<{ id: string }>(
      `SELECT l.organization_id AS id
         FROM bms.user_location_access ula
         JOIN bms.users u ON u.id = ula.user_id
         JOIN bms.locations l ON l.id = ula.location_id
        WHERE u.email = $1
        ORDER BY l.organization_id
        LIMIT 1`,
      [SEEDED.locationAdmin],
    );
    if (!orgB.rows[0] || !locationAdminOrg.rows[0]) {
      throw new Error("E3.1: the seeded organization and location admins have no grants — run pnpm db:seed.");
    }

    const created = await fleetPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id",
      [PREFIX, "E3.1 SLA policy fixture A"],
    );
    const orgA = created.rows[0]?.id;
    if (!orgA) throw new Error("E3.1: fixture organization A was not created");
    createdOrgIds.push(orgA);

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const service = new WorkOrderSlaPoliciesAdminService(fleetDb, tenantDb, new MasterDataAuditService(tenantDb, fleetDb));
    ctx = {
      controller: new WorkOrderSlaPoliciesAdminController(new AccessControlService(createDb(authPool), fleetDb), service),
      tenantDb,
      fleetPool,
      admin: jwtFor(SEEDED.globalAdmin, "admin"),
      organizationAdminOfB: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      orgA,
      orgB: orgB.rows[0].id,
      locationAdminOrgId: locationAdminOrg.rows[0].id,
    };
  });

  afterAll(async () => {
    // Bounded to the organization this run created: its policy rows, its audit rows, then it.
    if (fleetPool && createdOrgIds.length > 0) {
      await fleetPool.query("DELETE FROM bms.work_order_sla_policies WHERE organization_id = ANY($1)", [createdOrgIds]);
      await fleetPool.query("DELETE FROM bms.audit_log WHERE organization_id = ANY($1)", [createdOrgIds]);
      await fleetPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdOrgIds]);
    }
    await Promise.all([tenantPool, fleetPool, authPool].filter(Boolean).map((p) => p.end()));
  });

  it("answers four default rows for an organization with no policy", async () => {
    await aGetWithNoRowsAnswersFourDefaults(ctx);
  });

  it("replaces the organization's set on PUT and audits each PUT once", async () => {
    await aPutReplacesTheSetAndAuditsOnce(ctx);
  });

  it("refuses the organization admin of B for A", async () => {
    await anOrganizationAdminOfBIsRefusedForA(ctx);
  });

  it("refuses a location admin in the organization it holds a node in", async () => {
    await aLocationAdminIsRefusedInItsOwnOrganization(ctx);
  });

  it("answers 404 for an id that names no organization", async () => {
    await anUnknownOrganizationIsNotFound(ctx);
  });

  it("keeps A's rows out of B's tenant setting", async () => {
    await bsTenantSettingReadsNoneOfAsRows(ctx);
  });
});
