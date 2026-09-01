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
  assertAssetPointsRejectsAnUnlistedKey,
  assertCreateAuditRowIsOrgLess,
  assertEveryOrganizationSeesEveryCode,
  assertGlobalAdminLifecycle,
  assertOrganizationAdminIsRefusedEveryWrite,
} from "./point-keys.rls.integration.spec";

/**
 * `F3.39` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * This was `F4.16` Task 8, proving that `withTenant` really scoped a write to
 * `bms.point_keys`. Migration `0057` removes the policy that made that true, so
 * the suite now proves the inverse — see the `.spec` header for each swap. It
 * keeps the same four real, non-owner connections: the service reads and writes
 * on `bms_fleet` now, but the point of building it from real roles rather than
 * the owner connection is unchanged, and `bms_owner` remains the observer
 * precisely because FORCE used to bind it on this table.
 */
const connectionString = requireIntegrationDb({
  item: "F3.39",
  label: "PointKeysAdminService against a global point key catalog",
  because:
    "0057 drops the tenant policy, the FORCE flag and the organization_id from " +
    "bms.point_keys, and narrows the write path to the global admin role. Nothing else " +
    "asserts either half: a repo scan can see the SQL and the guard clause, but only a " +
    "real database can show that bms_owner reads the table with no GUC set, that the " +
    "org-less audit row survives Amendment 5's WITH CHECK, and that the new foreign key " +
    "on asset_points actually refuses an unlisted code.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000002";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F3.39 — the point key catalog is fleet-wide", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: PointKeysAdminService;
  const createdIds: string[] = [];

  const adminJwt = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");
  const orgAdminJwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "F3.39");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.39",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.39",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.39",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new PointKeysAdminService(
      fleetDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
    );
  });

  afterAll(async () => {
    // Defensive fallback only — each test deletes its own row immediately. A
    // no-op DELETE on an already-gone id is harmless, so this only matters if a
    // test threw before reaching its own cleanup.
    if (createdIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [createdIds]);
      await ownerPool.query("DELETE FROM bms.point_keys WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  it("lets a global admin create, read, update, deactivate and reactivate a code", async () => {
    const id = await assertGlobalAdminLifecycle({ svc, ownerPool }, adminJwt);
    createdIds.push(id);
    // Deleted here rather than deferred to afterAll: this row ends active=true
    // and would otherwise stay visible to concurrently-running integration
    // suites for the whole file's duration instead of just this test's.
    await ownerPool.query("DELETE FROM bms.audit_log WHERE entity_id = $1", [id]);
    await ownerPool.query("DELETE FROM bms.point_keys WHERE id = $1", [id]);
  });

  it("refuses an organization_admin every write to the fleet-wide catalog", async () => {
    await assertOrganizationAdminIsRefusedEveryWrite({ svc, ownerPool }, orgAdminJwt);
  });

  it("writes the create audit row with no organization, on the fleet connection", async () => {
    await assertCreateAuditRowIsOrgLess({ svc, ownerPool }, adminJwt);
  });

  it("shows every organization the same complete catalog", async () => {
    await assertEveryOrganizationSeesEveryCode(ownerPool, tenantPool);
  });

  it("refuses an asset_points row whose point_key is in no vocabulary", async () => {
    await assertAssetPointsRejectsAnUnlistedKey(ownerPool);
  });
});
