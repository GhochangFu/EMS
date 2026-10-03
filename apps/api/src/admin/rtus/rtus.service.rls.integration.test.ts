import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "./rtus.service";
import {
  assertLifecycleWroteFourAuditRows,
  assertNoFixtureRowsRemain,
  assertRtuWriteLifecycleSurvivesRealRls,
} from "./rtus.service.rls.integration.spec";
import { jwtFor, primeSeededSubjects } from "../../testing/seeded-subjects";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `assets.service.rls.integration.test.ts` against the other zero-coverage admin
 * write path.
 *
 * `F4.167` — the suite removes the `master.rtu.*` audit rows its lifecycle
 * writes, as `rtus.unique-conflict` and `rtus.telemetry-source` already do.
 * Until then every run left four audit rows naming an RTU that no longer
 * existed.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "RtusAdminService against real, non-owner roles",
  because:
    "RtusAdminService has no other test file. Constructing it with real " +
    "bms_auth/bms_tenant/bms_fleet connections is the only proof that the E7.1b " +
    "write funnel stamps organization_id from the RTU's location and wraps every " +
    "write in withTenant, rather than passing only because the owner connection " +
    "bypasses row-level security regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";

describe.skipIf(!connectionString)("E7.1b — RtusAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: RtusAdminService;
  let organizationId: string;
  let locationId: string;
  const createdIds: string[] = [];

  let jwt: JwtPayload;

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
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

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
    organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }
    locationId = loc.rows[0].id;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new RtusAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
    );
  });

  /**
   * `F4.167` — the audit rows go first, as in the sibling suites: a failure
   * between the two deletes then leaves the RTU row, whose `e7.1b-rtu-` code
   * names its author. `ownerPool` is `bms_fleet` (BYPASSRLS), so the audit
   * delete is not a silent 0-row delete under FORCE RLS.
   */
  async function removeRtuFixtures(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [ids]);
    await ownerPool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [ids]);
  }

  afterAll(async () => {
    // The safety net for a run that failed before the removal case below.
    await removeRtuFixtures(createdIds);
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  // One claim per `it`, in declaration order: the lifecycle, then its audit
  // rows, then their removal.
  it("creates, updates, deactivates and reactivates an RTU with a stamped org under real RLS", async () => {
    await assertRtuWriteLifecycleSurvivesRealRls(
      { svc, ownerPool, organizationId, locationId, createdIds },
      jwt,
    );
  });

  it("the lifecycle wrote exactly the four master.rtu.* audit rows", async () => {
    await assertLifecycleWroteFourAuditRows(ownerPool, createdIds[0]);
  });

  it("removing the fixture takes its audit rows with it", async () => {
    await removeRtuFixtures(createdIds);
    await assertNoFixtureRowsRemain(ownerPool, createdIds);
  });
});
