import { eq, or } from "drizzle-orm";

import type { JwtPayload, UserRole } from "@bms/shared";
import { locations, userLocationAccess, userOrganizationAccess, users } from "@bms/db";
import type { BmsDb } from "@bms/db";

/**
 * `F4.16` / ADR 0043 decision 12 + Amendment 1 — the one privileged read that
 * every authenticated request makes before either tenant pool can serve it.
 *
 * It runs on the **auth** pool, whose role reaches `bms.users` and nothing else.
 * It is deliberately **not cached**: caching the role re-introduces the demotion
 * drift the F3.8 review corrected, where a token outlives a demotion by up to
 * `JWT_TTL`.
 */
export interface DbIdentity {
  readonly id: string;
  readonly role: UserRole;
  readonly organizationIds: readonly string[];
}

export type PoolChoice =
  | { readonly kind: "fleet"; readonly userId: string; readonly role: UserRole }
  | {
      readonly kind: "tenant";
      readonly userId: string;
      readonly role: UserRole;
      readonly organizationId: string;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Pure, so every branch is enumerable without a database.
 *
 * Fails closed twice. An unprovisioned principal is refused rather than
 * defaulting — ADR 0021 Amendment 1 found that a Keycloak `admin` claim with no
 * `bms.users` row resolved to global admin, and pool selection must not re-open
 * it. A non-admin with no organization is refused rather than served an empty
 * tenant, because "sees nothing" and "is not provisioned" are different states
 * and only one of them should look like a working session.
 */
export function selectPool(identity: DbIdentity | null): PoolChoice {
  if (!identity) {
    return {
      kind: "refused",
      reason:
        "No bms.users row for this principal. A token claim is not authority for pool selection.",
    };
  }
  if (identity.role === "admin") {
    return { kind: "fleet", userId: identity.id, role: identity.role };
  }
  const organizationId = identity.organizationIds[0];
  if (!organizationId) {
    return {
      kind: "refused",
      reason: `User ${identity.id} has role ${identity.role} and no organization grant.`,
    };
  }
  return { kind: "tenant", userId: identity.id, role: identity.role, organizationId };
}

/** Reads the identity on the auth pool. Returns `null` when no row matches. */
export async function readIdentity(authDb: BmsDb, jwt: JwtPayload): Promise<DbIdentity | null> {
  const [row] = await authDb
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(or(eq(users.id, jwt.sub), eq(users.email, jwt.email)))
    .limit(1);
  if (!row) {
    return null;
  }
  const role = row.role as UserRole;
  if (role === "admin") {
    return { id: row.id, role, organizationIds: [] };
  }
  // E7.1 replaces this walk with bms.users.organization_id. Until the column
  // exists, the home organization is the one the grants already name.
  const direct = await authDb
    .select({ id: userOrganizationAccess.organizationId })
    .from(userOrganizationAccess)
    .where(eq(userOrganizationAccess.userId, row.id));
  if (direct.length > 0) {
    return { id: row.id, role, organizationIds: direct.map((r) => r.id) };
  }
  const viaLocation = await authDb
    .select({ id: locations.organizationId })
    .from(userLocationAccess)
    .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
    .where(eq(userLocationAccess.userId, row.id));
  return { id: row.id, role, organizationIds: [...new Set(viaLocation.map((r) => r.id))] };
}
