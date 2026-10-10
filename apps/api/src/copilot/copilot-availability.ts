import type { CopilotAvailabilityReason, CopilotSwitchableRole } from "@bms/shared";

import type { ResolvedIdentity } from "../auth/identity-resolver";

/** The four roles the copilot is offered to (ADR 0099 decision 5); operators and viewers get none. */
export const COPILOT_ROLES = ["admin", "organization_admin", "location_admin", "asset_group_admin"] as const;

export type CopilotAvailability =
  | { available: true }
  | { available: false; reason: CopilotAvailabilityReason };

/**
 * The three switch reads, bound to one organization. Each answers `null` when
 * there is no row, so the caller — not the store — decides what absence means.
 */
export interface CopilotAccessReads {
  orgEnabled(): Promise<boolean | null>;
  roleEnabled(role: CopilotSwitchableRole): Promise<boolean | null>;
  userOverride(userId: string): Promise<boolean | null>;
}

const isCopilotRole = (role: string): role is (typeof COPILOT_ROLES)[number] =>
  (COPILOT_ROLES as readonly string[]).includes(role);

const refuse = (reason: CopilotAvailabilityReason): CopilotAvailability => ({ available: false, reason });

/**
 * Whether `identity` may use the copilot in `organizationId` (`null` = a
 * cross-organization conversation). ADR 0099 decision 5, the `F3.85` plan §5.2
 * and its Q2 ruling; the order of the checks is load-bearing:
 *
 * 1. No user row → `not_provisioned`; a role outside the four → `role`. The
 *    role is the **database** row's, read before any exception, so an allow
 *    exception written for a `location_admin` does not survive a demotion.
 * 2. The global admin: a cross-organization conversation is available;
 *    inside an organization, that organization's switch binds them too
 *    (drafter choice 7).
 * 3. Every other administrator is bound to their own organization
 *    (decision 10), refused **before any switch is read**, so a
 *    `location_admin` of A learns nothing about B.
 * 4. The organization switch, absent = off (ruling 15), always wins (Q2).
 * 5. `organization_admin`: a deny exception narrows; it has no role switch.
 * 6. `location_admin` / `asset_group_admin`: an exception decides in either
 *    direction (Q2); with none, the role switch, absent = on (Q2).
 *
 * `open` is called only when a read is needed, once, for the organization
 * asked about — the service binds it to one `withTenant` transaction.
 */
export async function decideCopilotAvailability(
  identity: ResolvedIdentity | null,
  organizationId: string | null,
  open: (organizationId: string) => CopilotAccessReads,
): Promise<CopilotAvailability> {
  if (identity === null) {
    return refuse("not_provisioned");
  }
  if (!isCopilotRole(identity.role)) {
    return refuse("role");
  }
  if (identity.role === "admin") {
    if (organizationId === null) {
      return { available: true };
    }
    return (await open(organizationId).orgEnabled()) === true ? { available: true } : refuse("organization_off");
  }
  if (organizationId === null || identity.organizationId === null || identity.organizationId !== organizationId) {
    return refuse("other_organization");
  }
  const reads = open(organizationId);
  if ((await reads.orgEnabled()) !== true) {
    return refuse("organization_off");
  }
  const exception = await reads.userOverride(identity.id);
  if (identity.role === "organization_admin") {
    return exception === false ? refuse("user_denied") : { available: true };
  }
  if (exception !== null) {
    return exception ? { available: true } : refuse("user_denied");
  }
  return (await reads.roleEnabled(identity.role)) === false ? refuse("role_off") : { available: true };
}
