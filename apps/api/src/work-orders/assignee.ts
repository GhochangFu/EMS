import { and, eq, isNull } from "drizzle-orm";

import { users } from "@bms/db";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F4.285` (ADR 0106 decision 6) — the assignee check the work-order routes and the copilot's
 * `user` ref share. An assignee must be an **active** user (`disabled_at IS NULL`, ADR 0089
 * decision 8) **of the work order's organization**; a global admin has no organization and is
 * never one (owner ruling DC1, drafter choice DC-A).
 */

/** The one refusal sentence for every case — unknown id, another organization, disabled, no organization. */
export const ASSIGNEE_REFUSAL = "Assignee is not an active user of the work order's organization";

/**
 * An active user of `organizationId`, or `null`. Read inside the caller's tenant transaction:
 * `bms.users` carries FORCE ROW LEVEL SECURITY (`0047`), so the policy is a second fence under
 * the explicit organization filter.
 */
export async function readActiveOrganizationUser(
  tx: BmsTx,
  id: string,
  organizationId: string,
): Promise<{ id: string; displayName: string } | null> {
  const [row] = await tx
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId), isNull(users.disabledAt)))
    .limit(1);
  return row ?? null;
}
