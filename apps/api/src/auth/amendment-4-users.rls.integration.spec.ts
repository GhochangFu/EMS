import { expect } from "vitest";

import { sql } from "drizzle-orm";

import type { BmsDb } from "@bms/db";

import { withTenant } from "../database/tenant-context";

/**
 * `E7.1b` (ADR 0043 Amendment 4, plan Task 4 "test first") — `bms.users` carries
 * a nullable `organization_id` (a home org), gains `tenant_isolation` + `FORCE`
 * in `0047`, and keeps a permissive `auth_bootstrap_read` SELECT policy for
 * `bms_auth` so login still resolves a user before any tenant context exists.
 *
 * The two claims that need real, non-owner roles to show:
 *   - a global `admin` row is org-less (NULL after the `0046` backfill), so it is
 *     invisible to every single-tenant GUC yet visible via `bms_fleet` and — the
 *     load-bearing part — still readable by `bms_auth` for login;
 *   - a scoped user's row is stamped its home org and is visible only under that
 *     org's GUC, never another's.
 *
 * Policy-level proofs (raw pool SQL): the object under test is the `0047` policy
 * on `bms.users`, not a service. Before `0047` every SELECT below saw the row
 * regardless of role or GUC, so the discriminating assertions are the tenant
 * zeros.
 */

/**
 * The global `admin`'s `bms.users` row is NULL-org: invisible to any tenant GUC,
 * visible via `bms_fleet`, and still readable by `bms_auth` (the login path).
 */
export async function assertGlobalAdminUserIsNullOrgTenantInvisibleAuthReadable(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  authDb: BmsDb,
  adminUserId: string,
  anyOrgId: string,
): Promise<void> {
  // Fleet (BYPASSRLS) sees it, and its home org is NULL — the backfill leaves a
  // global admin org-less by design.
  const fleetSeen = await fleetDb.execute(
    sql`SELECT organization_id FROM bms.users WHERE id = ${adminUserId}`,
  );
  expect(fleetSeen.rows).toHaveLength(1);
  expect((fleetSeen.rows[0] as { organization_id: string | null }).organization_id).toBeNull();

  // Invisible to a tenant with any populated GUC, and with none set — a NULL-org
  // row never satisfies `organization_id = current_org`.
  await withTenant(tenantDb, anyOrgId, async (tx) => {
    const seen = await tx.execute(sql`SELECT id FROM bms.users WHERE id = ${adminUserId}`);
    expect(seen.rows).toHaveLength(0);
  });
  const noContext = await tenantDb.execute(sql`SELECT id FROM bms.users WHERE id = ${adminUserId}`);
  expect(noContext.rows).toHaveLength(0);

  // `bms_auth` must still read it — `auth_bootstrap_read USING (true)` is what
  // keeps login working before the fleet pool is reached.
  const authSeen = await authDb.execute(sql`SELECT id FROM bms.users WHERE id = ${adminUserId}`);
  expect(authSeen.rows).toHaveLength(1);
}

/**
 * A scoped user's `bms.users` row is stamped its home org and is visible only
 * under that org's GUC — proving the backfill stamped it and the policy isolates
 * it, both — while `bms_auth` still reads it for login regardless of org.
 */
export async function assertScopedUserVisibleOnlyUnderOwnOrg(
  tenantDb: BmsDb,
  fleetDb: BmsDb,
  authDb: BmsDb,
  scopedUserId: string,
  homeOrgId: string,
  otherOrgId: string,
): Promise<void> {
  const fleetSeen = await fleetDb.execute(
    sql`SELECT organization_id FROM bms.users WHERE id = ${scopedUserId}`,
  );
  expect(fleetSeen.rows).toHaveLength(1);
  expect((fleetSeen.rows[0] as { organization_id: string | null }).organization_id).toBe(homeOrgId);

  await withTenant(tenantDb, homeOrgId, async (tx) => {
    const seen = await tx.execute(sql`SELECT id FROM bms.users WHERE id = ${scopedUserId}`);
    expect(seen.rows).toHaveLength(1);
  });
  await withTenant(tenantDb, otherOrgId, async (tx) => {
    const seen = await tx.execute(sql`SELECT id FROM bms.users WHERE id = ${scopedUserId}`);
    expect(seen.rows).toHaveLength(0);
  });

  const authSeen = await authDb.execute(sql`SELECT id FROM bms.users WHERE id = ${scopedUserId}`);
  expect(authSeen.rows).toHaveLength(1);
}

/**
 * Amendment 4's invariant over the *seeded* rows: after the seed, no
 * tenant-scoped user is org-less. This mirrors migration `0046`'s step-4 abort
 * (`organization_id IS NULL AND role <> 'admin'`) but reads it back on a real DB
 * after seeding, which is where it actually bites: on CI's fresh database `0046`
 * runs against an empty `bms.users`, so its own abort sees zero rows and cannot
 * fire — the seed is the only thing that stamps a fresh row's home org. This
 * gates *every* scoped demo user (both `seedScopedDemoUsers` logins and
 * `seedPheOrganizationAdmin`), not just the one `phe-admin` the visibility proofs
 * above happen to read, so dropping the stamp in either function fails here.
 */
export async function assertNoTenantScopedUserIsOrgLess(fleetDb: BmsDb): Promise<void> {
  const orgless = await fleetDb.execute(
    sql`SELECT count(*)::int AS n FROM bms.users WHERE organization_id IS NULL AND role <> 'admin'`,
  );
  expect(
    (orgless.rows[0] as { n: number }).n,
    "every tenant-scoped user carries a home organization (Amendment 4)",
  ).toBe(0);
}
