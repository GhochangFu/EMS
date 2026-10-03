import type { UserRole } from "@bms/shared";

/**
 * `F3.78` / ADR 0089 decision 2 — who may manage whom, as pure functions over
 * values the service has already read. Every input is the **database row's**
 * role (`resolveIdentity`), never `jwt.role`: a token outlives a demotion.
 */

export type ManagerRole = "admin" | "organization_admin";

/** The two roles that may administer users; every other role is a 403. */
export function isManagerRole(role: UserRole | string): role is ManagerRole {
  return role === "admin" || role === "organization_admin";
}

/** A target user's whole reach: its home organization and every organization a grant of it names. */
export type TargetReach = {
  readonly role: UserRole;
  readonly homeOrganizationId: string | null;
  readonly grantOrganizationIds: readonly string[];
};

/**
 * Whether `callerRole` (with `writableOrganizationIds`, `null` meaning
 * unrestricted) may act on `target`. **Fails closed:**
 *
 * - `admin` manages every user.
 * - any target whose role is `admin` is `admin`-only, on every action;
 * - an `organization_admin` needs the target's whole reach (home organization
 *   ∪ grant organizations) to be a non-empty subset of its own organizations;
 *   a `NULL` home organization counts as outside, never as an empty set;
 * - an unrestricted (`null`) list for anyone but `admin` is a defect upstream,
 *   and is refused rather than read as "everything".
 */
export function canManageTarget(
  callerRole: ManagerRole,
  writableOrganizationIds: readonly string[] | null,
  target: TargetReach,
): boolean {
  if (callerRole === "admin") {
    return true;
  }
  if (target.role === "admin") {
    return false;
  }
  if (writableOrganizationIds === null || target.homeOrganizationId === null) {
    return false;
  }
  const reach = new Set([target.homeOrganizationId, ...target.grantOrganizationIds]);
  return [...reach].every((id) => writableOrganizationIds.includes(id));
}

/** An `organization_admin` may give any role except `admin`. */
export function mayAssignRole(callerRole: ManagerRole, role: UserRole): boolean {
  return callerRole === "admin" || role !== "admin";
}

/**
 * Whether a write touches a row whose old or new role is `admin`. Such a write
 * runs on `bms_fleet`: the `0048` policy's `NULL`-organization branch is
 * `TO bms_fleet` only.
 */
export function touchesAdmin(oldRole: UserRole, newRole: UserRole): boolean {
  return oldRole === "admin" || newRole === "admin";
}

/**
 * The `PATCH` boundary rules that need the target's current role (decision 1):
 * `organizationId` is accepted only when the role crosses the `admin`
 * boundary; a promotion to `admin` must send `organizationId: null`; a
 * demotion from `admin` must name an organization. `null` when the change is
 * valid.
 */
export function roleChangeError(
  fromRole: UserRole,
  body: { readonly role?: UserRole; readonly organizationId?: string | null },
): string | null {
  const toRole = body.role ?? fromRole;
  const crosses = (fromRole === "admin") !== (toRole === "admin");
  if (!crosses) {
    return body.organizationId === undefined
      ? null
      : "organizationId is accepted only when the role crosses the admin boundary";
  }
  if (toRole === "admin") {
    return body.organizationId === null ? null : "a promotion to admin must send organizationId null";
  }
  return typeof body.organizationId === "string" ? null : "a demotion from admin must name an organization";
}
