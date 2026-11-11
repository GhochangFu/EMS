import { userOrganizationAccess } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { JwtPayload, UserRole } from "@bms/shared";

import type { MasterDataAuditService } from "../master-data-audit.service";

/**
 * `F4.340` / ADR 0128 decisions 1–3. An `organization_admin`'s scope is only
 * its `bms.user_organization_access` rows (`directOrganizationIds`); the home
 * organization on `bms.users` is never read for scope. So the user routes
 * write the home grant themselves, in the caller's transaction:
 *
 * - on create of an `organization_admin` (decision 1), and
 * - on a role change **to** `organization_admin` (decision 2).
 *
 * The insert is `ON CONFLICT DO NOTHING` on `(user_id, organization_id)`, so a
 * promotion of a user that already holds the grant adds nothing and audits
 * nothing. A new row gets its own `master.user_grant.add` audit row with
 * `reason: "home_organization"` (decision 3), beside the route's own row.
 *
 * The caller's transaction is `withTenant(home)` (or `bms_fleet` when the
 * write touches `admin`), so the `0040` tenant policy on the table admits the
 * row. The home organization was already checked against the caller's
 * writable organizations, so this grant widens no one.
 */
export async function writeHomeOrganizationGrant(
  tx: Pick<BmsDb, "insert">,
  audit: MasterDataAuditService,
  actor: JwtPayload,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .insert(userOrganizationAccess)
    .values({ userId, organizationId })
    .onConflictDoNothing()
    .returning({ id: userOrganizationAccess.id });
  if (!row) {
    return false;
  }
  await audit.write(
    {
      actor,
      action: "master.user_grant.add",
      entityType: "user_grant",
      entityId: row.id,
      organizationId,
      payload: { userId, kind: "organization", targetId: organizationId, reason: "home_organization" },
    },
    tx as BmsDb,
  );
  return true;
}

/** Whether a write that leaves the user at `role` owes the home grant (ADR 0128 decisions 1 and 2). */
export function owesHomeOrganizationGrant(role: UserRole): boolean {
  return role === "organization_admin";
}
