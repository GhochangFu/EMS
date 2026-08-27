import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  assertGlobalAdminUserIsNullOrgTenantInvisibleAuthReadable,
  assertScopedUserVisibleOnlyUnderOwnOrg,
} from "./amendment-4-users.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. It reads two seeded users
 * — the global `admin` (org-less after the `0046` backfill) and a scoped
 * organization admin (stamped its home org) — and drives the `0047` `bms.users`
 * `tenant_isolation` + `auth_bootstrap_read` policies with a real
 * `bms_auth`/`bms_tenant`/`bms_fleet` trio. No fixtures are written; the seeded
 * rows already carry the two org shapes the proof needs.
 *
 * This covers the READ half of Amendment 4 on `bms.users` — `tenant_isolation`
 * (a global admin's row is invisible under any tenant, visible via fleet) and
 * `auth_bootstrap_read` (still readable by auth for login) — plus that a scoped
 * user's row is org-stamped and tenant-isolated. It does NOT exercise the write
 * policy `auth_bootstrap_write` (UPDATE `USING (true) WITH CHECK (true)`, so
 * login can stamp any user's `last_login_at`); that policy is row-unrestricted
 * and its only containment is the `UPDATE (last_login_at)` column grant, pinned
 * by `role-grants.integration.spec`'s `assertAuthCanUpdateOnlyLastLogin`.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "bms.users 0047 tenant_isolation + auth_bootstrap_read against real, non-owner roles",
  because:
    "Amendment 4 makes bms.users.organization_id nullable (a global admin is org-less), gives the " +
    "table tenant_isolation + FORCE in 0047, and keeps auth_bootstrap_read so login resolves a user " +
    "pre-tenant. Only real bms_auth/bms_tenant/bms_fleet connections prove the admin row is hidden " +
    "from every tenant yet readable by auth, and a scoped user's row is visible only under its own " +
    "org — the owner connection would bypass the policy and see every user regardless.",
});

const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const SCOPED_ADMIN_EMAIL = "phe-admin@bms.local";

describe.skipIf(!connectionString)("E7.1b — bms.users Amendment 4 policies under real RLS", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantDb: BmsDb;
  let fleetDb: BmsDb;
  let authDb: BmsDb;
  let adminUserId = "";
  let anyOrgId = "";

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b"); // fleet (BYPASSRLS) by default
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    fleetDb = createDb(ownerPool);
    tenantDb = createDb(tenantPool);
    authDb = createDb(authPool);

    // Only the global-admin case's prerequisites belong here — its `it` must not
    // be taken down by the scoped-user fixture, which each other `it` resolves
    // for itself. A populated GUC (any real org) is enough to prove the NULL-org
    // row is invisible under a tenant.
    const admin = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.users WHERE email = $1 LIMIT 1",
      [GLOBAL_ADMIN_EMAIL],
    );
    if (!admin.rows[0]) {
      throw new Error(`E7.1b: ${GLOBAL_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);
    }
    adminUserId = admin.rows[0].id;

    const anyOrg = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations LIMIT 1",
    );
    if (!anyOrg.rows[0]) {
      throw new Error("E7.1b: need at least one organization to prove tenant invisibility.");
    }
    anyOrgId = anyOrg.rows[0].id;
  });

  afterAll(async () => {
    await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
  });

  /**
   * Resolves the scoped-user fixture for the cases that need it. Kept out of
   * `beforeAll` on purpose: an org-less scoped user is a seed defect that must
   * fail *this* case, not silently take down the global-admin proof above.
   */
  async function resolveScopedUserFixture(): Promise<{
    scopedUserId: string;
    homeOrgId: string;
    otherOrgId: string;
  }> {
    const scoped = await ownerPool.query<{ id: string; organization_id: string | null }>(
      "SELECT id, organization_id FROM bms.users WHERE email = $1 LIMIT 1",
      [SCOPED_ADMIN_EMAIL],
    );
    if (!scoped.rows[0]) {
      throw new Error(`E7.1b: ${SCOPED_ADMIN_EMAIL} is not seeded — run pnpm db:seed.`);
    }
    if (!scoped.rows[0].organization_id) {
      throw new Error(
        `E7.1b: ${SCOPED_ADMIN_EMAIL}.organization_id is NULL — the seed did not stamp its home org ` +
          "(ADR 0043 Amendment 4: every tenant-scoped user carries a home organization).",
      );
    }
    const homeOrgId = scoped.rows[0].organization_id;

    const other = await ownerPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE id <> $1 LIMIT 1",
      [homeOrgId],
    );
    if (!other.rows[0]) {
      throw new Error("E7.1b: need a second organization to prove the scoped user is org-isolated.");
    }
    return { scopedUserId: scoped.rows[0].id, homeOrgId, otherOrgId: other.rows[0].id };
  }

  it("hides the global admin's NULL-org row from tenants, keeps it readable by auth and fleet", async () => {
    await assertGlobalAdminUserIsNullOrgTenantInvisibleAuthReadable(
      tenantDb,
      fleetDb,
      authDb,
      adminUserId,
      anyOrgId,
    );
  });

  it("makes a scoped user visible only under its own org, still readable by auth", async () => {
    const { scopedUserId, homeOrgId, otherOrgId } = await resolveScopedUserFixture();
    await assertScopedUserVisibleOnlyUnderOwnOrg(
      tenantDb,
      fleetDb,
      authDb,
      scopedUserId,
      homeOrgId,
      otherOrgId,
    );
  });
});
