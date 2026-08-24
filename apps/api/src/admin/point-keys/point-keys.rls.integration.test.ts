import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { PointKeysAdminService } from "./point-keys.service";
import {
  assertPolicyRefusesMismatchedOrg,
  assertRefusesOutOfScopeOrganization,
  assertWriteLifecycleSurvivesRealRls,
} from "./point-keys.rls.integration.spec";

/**
 * `F4.16` Task 8 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. See
 * `locations.rls.integration.test.ts` for the full rationale; this is the
 * same shape against the other zero-coverage RLS write path.
 */
const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "PointKeysAdminService against real, non-owner roles",
  because:
    "point-keys.service.ts has no other test file at all. Constructing the service with " +
    "real bms_auth/bms_tenant/bms_fleet connections is the only proof that withTenant " +
    "actually enforces row-level security on create/update/deactivate/reactivate, rather " +
    "than passing only because the owner connection bypasses it regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000002";

function jwtFor(email: string): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role: "organization_admin" };
}

describe.skipIf(!connectionString)("F4.16 — PointKeysAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: PointKeysAdminService;
  let organizationId: string;
  let secondOrganizationId: string;
  const createdIds: string[] = [];

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL);

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F4.16");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.16",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.16",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.16",
    );

    const { rows } = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!rows[0]) {
      throw new Error(
        `F4.16: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    organizationId = rows[0].id;

    const { rows: others } = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [organizationId],
    );
    if (!others[0]) {
      throw new Error("F4.16: need a second organization to prove cross-org refusal.");
    }
    secondOrganizationId = others[0].id;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new PointKeysAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), tenantDb, fleetDb),
      new MasterDataAuditService(tenantDb),
    );
  });

  afterAll(async () => {
    // Defensive fallback only — the happy-path test below deletes its own row
    // immediately. A no-op DELETE on an already-gone id is harmless, so this
    // only matters if that test threw before reaching its own cleanup.
    if (createdIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.point_keys WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  it("creates, reads, updates, deactivates and reactivates a point key under real RLS", async () => {
    const id = await assertWriteLifecycleSurvivesRealRls(
      { svc, ownerPool, organizationId },
      jwt,
    );
    createdIds.push(id);
    // Deleted here, not deferred to afterAll — see locations.rls.integration.
    // test.ts's identical comment for why: this row ends active=true and
    // would otherwise stay visible to concurrently-running integration
    // suites for the whole file's duration instead of just this test's.
    await ownerPool.query("DELETE FROM bms.point_keys WHERE id = $1", [id]);
  });

  it("refuses an organization_admin creating a point key outside their granted organization", async () => {
    await assertRefusesOutOfScopeOrganization({ svc, ownerPool, organizationId }, jwt);
  });

  it("refuses a write whose row claims a different organization than SET LOCAL names (WITH CHECK)", async () => {
    await assertPolicyRefusesMismatchedOrg(
      createDb(tenantPool),
      organizationId,
      secondOrganizationId,
    );
  });
});
