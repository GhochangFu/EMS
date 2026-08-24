import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { LocationsAdminService } from "./locations.service";

/**
 * `F4.16` Task 8 — the write-path coverage `locations.service.ts` had none of.
 *
 * Every other RLS-adjacent service on this branch either has its own
 * integration suite exercising it against real, non-owner roles, or — for the
 * three `asset-templates` suites — was rewired onto real roles by this same
 * task. `LocationsAdminService` had neither: zero test files of any kind. A
 * `withTenant(` wrapper silently deleted from `create`/`update`/`deactivate`/
 * `reactivate` would ship undetected, exactly the class of regression Task 6.6
 * found and fixed for ~20 other services.
 *
 * Fixtures are the ones `pnpm db:seed` already creates (`access-control.
 * integration.spec.ts`'s `SEEDED.organizationAdmin`, a real `phe-admin@bms.
 * local` PHEWB `organization_admin`) rather than hand-built ones — this suite
 * only needs one real tenant to write into, not a full cross-organization
 * fixture set.
 */
const connectionString = requireIntegrationDb({
  item: "F4.16",
  label: "LocationsAdminService against real, non-owner roles",
  because:
    "locations.service.ts has no other test file at all. Constructing the service with " +
    "real bms_auth/bms_tenant/bms_fleet connections is the only proof that withTenant " +
    "actually enforces row-level security on create/update/deactivate/reactivate, rather " +
    "than passing only because the owner connection bypasses it regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000001";

function jwtFor(email: string): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role: "organization_admin" };
}

describe.skipIf(!connectionString)("F4.16 — LocationsAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: LocationsAdminService;
  let organizationId: string;
  let createdId: string | undefined;

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

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new LocationsAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), tenantDb, fleetDb),
      new MasterDataAuditService(tenantDb),
    );
  });

  afterAll(async () => {
    // Direct owner-connection cleanup, matching this branch's live-verification
    // convention: RLS is what is under test, not the teardown path.
    if (createdId) {
      await ownerPool.query("DELETE FROM bms.locations WHERE id = $1", [createdId]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  it("creates, reads, updates, deactivates and reactivates a location under real RLS", async () => {
    const created = await svc.create(jwt, {
      organizationId,
      code: `F4.16-RLS-${Date.now()}`,
      slug: `f4-16-rls-${Date.now()}`,
      name: "F4.16 RLS write-path check",
      type: "rsmoc",
      latitude: 0,
      longitude: 0,
    });
    createdId = created.id;
    expect(created.organizationId).toBe(organizationId);
    expect(created.active).toBe(true);

    // Written on the tenant connection under a real SET LOCAL — if withTenant
    // were silently missing, this insert would fail here with a row-level
    // security policy violation rather than merely being unscoped.
    const [ownerRow] = (
      await ownerPool.query<{ organization_id: string }>(
        "SELECT organization_id FROM bms.locations WHERE id = $1",
        [createdId],
      )
    ).rows;
    expect(ownerRow?.organization_id).toBe(organizationId);

    const fetched = await svc.getById(jwt, created.id);
    expect(fetched.name).toBe("F4.16 RLS write-path check");

    const updated = await svc.update(jwt, created.id, { name: "F4.16 RLS write-path renamed" });
    expect(updated.name).toBe("F4.16 RLS write-path renamed");

    const deactivated = await svc.deactivate(jwt, created.id);
    expect(deactivated.active).toBe(false);

    const reactivated = await svc.reactivate(jwt, created.id);
    expect(reactivated.active).toBe(true);
  });

  it("refuses an organization_admin creating a location outside their granted organization", async () => {
    const { rows } = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [organizationId],
    );
    if (!rows[0]) {
      throw new Error("F4.16: need a second organization to prove cross-org refusal.");
    }
    await expect(
      svc.create(jwt, {
        organizationId: rows[0].id,
        code: `F4.16-RLS-DENY-${Date.now()}`,
        slug: `f4-16-rls-deny-${Date.now()}`,
        name: "must never be created",
        type: "rsmoc",
        latitude: 0,
        longitude: 0,
      }),
    ).rejects.toThrow(/access scope/i);
  });
});
