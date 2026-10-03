import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { getOrganizationId } from "./hierarchy-seed";
import {
  assetGroups,
  users,
  userAssetGroupAccess,
  userLocationAccess,
  userOrganizationAccess,
} from "./schema/bms-schema";

/**
 * Demo logins and their access grants, split out of `seed.ts` to keep it under
 * the AGENTS.md §4.5 1000-line cap. Pure move: one user per read-scope source,
 * which is what `apps/api/src/auth/access-control.integration.spec.ts` asserts
 * against — the emails and roles here are that suite's fixture contract.
 *
 * **`E7.1b` / ADR 0043 decision 5 + Amendment 4.** `seed.ts` runs all three
 * exported functions on the superuser connection rather than the `FORCE`-bound
 * `bms_owner` seed pool. See `resolveSeedSuperuserUrl` in `seed-tenant.ts`: under
 * `0047`'s strict `USING`, `bms_owner` cannot see or `RETURNING`-insert the
 * global `admin`'s NULL-org row, and the pool roles have no `INSERT` on
 * `bms.users` at all.
 *
 * Per Amendment 4 every tenant-scoped user carries a home `organization_id`
 * (`phe-admin` → PHEWB; `wc-admin`/`wc-hvac-admin` → the ESKOM org that owns the
 * Western Cape location and asset groups — there is no separate Western Cape
 * org), matching what migration `0046`'s backfill resolves from each user's
 * grants on a
 * pre-existing database. The seed stamps it on insert because `0046` runs before
 * the seed and so backfills an empty table — the seed is the only place a
 * fresh-database row gets its home. Only the global `admin` (a fleet actor,
 * decision 2) is org-less — a NULL home, invisible to every tenant GUC. `adminId`
 * is still usable as an FK from `bms_owner`-pool inserts (alarms, work orders): a
 * foreign-key check is not row-level-security-filtered.
 */

const SCOPED_USERS = [
  {
    email: "wc-admin@bms.local",
    password: "admin123",
    displayName: "Western Cape Location Admin",
    role: "location_admin",
  },
  {
    email: "wc-hvac-admin@bms.local",
    password: "admin123",
    displayName: "Western Cape HVAC Admin",
    role: "asset_group_admin",
  },
] as const;

/** One seeded demo login, as `upsertSeededUser` writes it. */
export type SeededUserSpec = {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly role: string;
  readonly organizationId: string | null;
};

/**
 * `F3.78` (ADR 0089, plan §5) — the per-row step every seeded scoped login
 * shares: insert it when absent, re-assert its name, role and home
 * organization when present **and unlinked**, and touch nothing when present
 * and linked.
 *
 * A row whose `oidc_subject` is set has signed in through Keycloak and is
 * administered through the users API from then on. Re-asserting the seed's
 * role there would silently revert an admin's demotion on the next
 * `compose up` (every `compose up` re-seeds), with no audit row and with the
 * Keycloak realm role left out of step. An unlinked row keeps today's upsert:
 * local mode never links, and local mode is read-only for user writes, so
 * nothing is reverted there.
 *
 * `linked: true` tells the caller to touch nothing else for this user either:
 * its grants are administered through the API too.
 */
export async function upsertSeededUser(
  db: BmsDb,
  spec: SeededUserSpec,
): Promise<{ id: string; linked: boolean } | null> {
  const [existing] = await db
    .select({ id: users.id, subject: users.oidcSubject })
    .from(users)
    .where(eq(users.email, spec.email))
    .limit(1);
  if (existing) {
    if (existing.subject !== null) {
      return { id: existing.id, linked: true };
    }
    await db
      .update(users)
      .set({ displayName: spec.displayName, role: spec.role, organizationId: spec.organizationId })
      .where(eq(users.id, existing.id));
    return { id: existing.id, linked: false };
  }
  const [created] = await db
    .insert(users)
    .values({
      email: spec.email,
      passwordHash: await bcrypt.hash(spec.password, 10),
      displayName: spec.displayName,
      role: spec.role,
      organizationId: spec.organizationId,
    })
    .returning({ id: users.id });
  return created ? { id: created.id, linked: false } : null;
}

/** Ensures the global `admin@bms.local` login exists, returning its id. */
export async function ensureAdminUser(db: BmsDb): Promise<string> {
  const adminEmail = "admin@bms.local";
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail))
    .limit(1);

  const existingId = existing[0]?.id;
  if (existingId) {
    return existingId;
  }
  const passwordHash = await bcrypt.hash("admin123", 10);
  const inserted = await db
    .insert(users)
    .values({
      email: adminEmail,
      passwordHash,
      displayName: "System Administrator",
      role: "admin",
    })
    .returning({ id: users.id });
  const adminId = inserted[0]?.id;
  if (!adminId) {
    throw new Error("Failed to insert admin user");
  }
  return adminId;
}

/** The seed key (the canonical slug) of the location `wc-admin` is scoped to. */
export const WC_ADMIN_LOCATION_KEY = "rsmoc-western-cape";

/**
 * Creates the location- and asset-group-scoped demo logins and grants each the
 * one scope its role is meant to demonstrate.
 *
 * **`E7.1b`: this runs on the superuser connection** (`seed.ts`), not the
 * `bms_owner` seed pool. `0047` makes `bms.users` `FORCE`-bound, so `bms_owner`
 * can neither see these rows (a re-seed's existence check would read empty and
 * duplicate-key) nor `INSERT ... RETURNING` one. `organizationId` is the ESKOM
 * org (owner of the Western Cape location and groups): it stamps each scoped
 * user's home org (Amendment 4 — `wc-admin` resolves there through
 * `user_location_access → locations.organization_id`, `wc-hvac-admin` through its
 * asset group's own `organization_id`). The Western Cape location is no longer
 * looked up here: `westernCapeId` is the row `seedEskomLocations` resolved for
 * RSMOC-WC (`seed.ts` passes it, owner ruling 17), or `null` when no row is the
 * seed's. The grants it writes,
 * `user_location_access` and `user_asset_group_access`, are `FORCE`-policied by
 * `0098` (F3.78 / ADR 0089 decision 10), keyed on the location's and the asset
 * group's organization. This path runs on the superuser connection and bypasses
 * that policy by design: the seed writes fixed demo grants before any tenant
 * context exists, and the rows it writes are in the ESKOM organization anyway.
 */
export async function seedScopedDemoUsers(
  db: BmsDb,
  organizationId: string,
  westernCapeId: string | null,
): Promise<void> {
  const scopedUserIds = new Map<string, string>();
  for (const scopedUser of SCOPED_USERS) {
    const seeded = await upsertSeededUser(db, { ...scopedUser, organizationId });
    // A linked row is administered through the users API (F3.78): its grants too.
    if (seeded && !seeded.linked) {
      scopedUserIds.set(scopedUser.email, seeded.id);
    }
  }

  // Owner ruling 17 (addendum 4 section 3): the row `seedEskomLocations`
  // resolved for RSMOC-WC's identity, never a row found by slug: an admin
  // location may hold `rsmoc-western-cape` while the seed's row keeps another
  // slug. `null` (the identity was ambiguous, so no row is the seed's) grants
  // nothing: neither wc-admin's location grant nor wc-hvac-admin's, whose
  // `hvac` group is found under this row. The location seed's line names every
  // candidate.
  const westernCape = westernCapeId === null ? undefined : { id: westernCapeId };
  const wcAdminId = scopedUserIds.get("wc-admin@bms.local");
  if (westernCape && wcAdminId) {
    const existingAccess = await db
      .select({ id: userLocationAccess.id })
      .from(userLocationAccess)
      .where(
        and(
          eq(userLocationAccess.userId, wcAdminId),
          eq(userLocationAccess.locationId, westernCape.id),
        ),
      )
      .limit(1);
    if (!existingAccess[0]) {
      await db.insert(userLocationAccess).values({
        userId: wcAdminId,
        locationId: westernCape.id,
      });
    }
  }

  const wcHvacAdminId = scopedUserIds.get("wc-hvac-admin@bms.local");
  if (westernCape && wcHvacAdminId) {
    const [hvacGroup] = await db
      .select({ id: assetGroups.id })
      .from(assetGroups)
      .where(
        and(
          eq(assetGroups.code, "hvac"),
          eq(assetGroups.locationId, westernCape.id),
        ),
      )
      .limit(1);
    if (hvacGroup) {
      const existingGroupAccess = await db
        .select({ id: userAssetGroupAccess.id })
        .from(userAssetGroupAccess)
        .where(
          and(
            eq(userAssetGroupAccess.userId, wcHvacAdminId),
            eq(userAssetGroupAccess.assetGroupId, hvacGroup.id),
          ),
        )
        .limit(1);
      if (!existingGroupAccess[0]) {
        await db.insert(userAssetGroupAccess).values({
          userId: wcHvacAdminId,
          assetGroupId: hvacGroup.id,
        });
      }
    }
  }
}

/** Creates the PHEWB organization admin and grants it organization scope. */
export async function seedPheOrganizationAdmin(
  db: BmsDb,
  pool: pg.Pool,
): Promise<void> {
  const phewbOrgId = await getOrganizationId(pool, "PHEWB");
  const seeded = await upsertSeededUser(db, {
    email: "phe-admin@bms.local",
    password: "admin123",
    displayName: "PHE Organization Admin",
    role: "organization_admin",
    organizationId: phewbOrgId,
  });
  // A linked row is administered through the users API (F3.78): touch nothing, its grant included.
  const pheAdminId = seeded && !seeded.linked ? seeded.id : undefined;
  if (pheAdminId) {
    const existingOrgAccess = await db
      .select({ id: userOrganizationAccess.id })
      .from(userOrganizationAccess)
      .where(
        and(
          eq(userOrganizationAccess.userId, pheAdminId),
          eq(userOrganizationAccess.organizationId, phewbOrgId),
        ),
      )
      .limit(1);
    if (!existingOrgAccess[0]) {
      await db.insert(userOrganizationAccess).values({
        userId: pheAdminId,
        organizationId: phewbOrgId,
      });
    }
  }
}
