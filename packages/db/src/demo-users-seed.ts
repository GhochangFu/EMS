import bcrypt from "bcrypt";
import { and, eq } from "drizzle-orm";
import type pg from "pg";

import type { BmsDb } from "./client";
import { getOrganizationId } from "./hierarchy-seed";
import {
  assetGroups,
  locations,
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

/**
 * Creates the location- and asset-group-scoped demo logins and grants each the
 * one scope its role is meant to demonstrate.
 */
export async function seedScopedDemoUsers(db: BmsDb): Promise<void> {
  const scopedUserIds = new Map<string, string>();
  for (const scopedUser of SCOPED_USERS) {
    const existingScopedUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, scopedUser.email))
      .limit(1);
    if (existingScopedUser[0]) {
      await db
        .update(users)
        .set({
          displayName: scopedUser.displayName,
          role: scopedUser.role,
        })
        .where(eq(users.id, existingScopedUser[0].id));
      scopedUserIds.set(scopedUser.email, existingScopedUser[0].id);
      continue;
    }
    const [createdScopedUser] = await db
      .insert(users)
      .values({
        email: scopedUser.email,
        passwordHash: await bcrypt.hash(scopedUser.password, 10),
        displayName: scopedUser.displayName,
        role: scopedUser.role,
      })
      .returning({ id: users.id });
    if (createdScopedUser) {
      scopedUserIds.set(scopedUser.email, createdScopedUser.id);
    }
  }

  const [westernCape] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, "rsmoc-western-cape"))
    .limit(1);
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
  const pheAdminEmail = "phe-admin@bms.local";
  const existingPheAdmin = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, pheAdminEmail))
    .limit(1);
  let pheAdminId = existingPheAdmin[0]?.id;
  if (!pheAdminId) {
    const [createdPheAdmin] = await db
      .insert(users)
      .values({
        email: pheAdminEmail,
        passwordHash: await bcrypt.hash("admin123", 10),
        displayName: "PHE Organization Admin",
        role: "organization_admin",
      })
      .returning({ id: users.id });
    pheAdminId = createdPheAdmin?.id;
  } else {
    await db
      .update(users)
      .set({
        displayName: "PHE Organization Admin",
        role: "organization_admin",
      })
      .where(eq(users.id, pheAdminId));
  }
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
