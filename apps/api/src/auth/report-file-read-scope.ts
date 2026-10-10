import { eq } from "drizzle-orm";

import { locations, userLocationAccess } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { directOrganizationIds, type ScopeUser } from "./access-scope-sources";
import { expandLocationSubtrees } from "./location-tree";

/**
 * The report-file read scope and the row verdict derived from it, moved here
 * whole from `access-control.service.ts` under AGENTS.md §4.5 ahead of
 * `F2.10`'s closure edits (the service stood at 934 lines against the
 * 1000-line cap). `reportFileReadScopeFor` is the body of
 * `AccessControlService.reportFileReadScope` after the user is resolved and
 * `assertMasterDataRole` has run; `canReadReportFileFor` is the body of
 * `canReadReportFile` after the scope is in hand. The service keeps a
 * delegating method for each, so the 4 callers (`report-files.service.ts`,
 * `report-schedules.service.ts`) did not change.
 *
 * Every read runs on `fleetDb` (`bms_fleet`, `BYPASSRLS`) for the reason the
 * service's class docblock gives — scope resolution runs before any tenant
 * context exists — and each is keyed by the actor's own `userId`, never a
 * caller-supplied id. The `WHERE` filter is the isolation control (ADR 0043
 * Amendment 2/3).
 */

/** The inputs the report-file list route turns into a SQL predicate (`F3.5a`, ADR 0071 decision 6). */
export type ReportFileReadScope =
  | { kind: "global" }
  | { kind: "organization"; organizationIds: string[] }
  | { kind: "location"; organizationIds: string[]; locationIds: string[] };

/**
 * One shape per master-data role (`F3.5a`, ADR 0071 decision 6 / Amendment 1
 * item 3):
 *
 * - `admin` → `global`: every organization, no filter.
 * - `organization_admin` → the organizations of their **direct**
 *   `user_organization_access` grants. `writableOrganizationIds` would give
 *   the same list for this role, but it is *location-derived* for a
 *   `location_admin`, which is why this branches on the role itself rather
 *   than on that helper's output.
 * - `location_admin` → the subtree closure of their `user_location_access`
 *   rows (the same set `writableLocationIds` returns since `F2.10`, inactive
 *   locations included) plus the organizations the granted nodes belong to,
 *   so the route can bound the organization filter before applying
 *   `location_ids <@ $writable`.
 *
 * The caller has already refused `asset_group_admin`, `operator` and `viewer`
 * through `assertMasterDataRole` **before** any grant is read: a report file's
 * scope is a set of location ids, and a role with no location set has nothing
 * to match it against (decision 6's `wc-hvac-admin` case). The row verdict
 * {@link canReadReportFileFor} is derived from this same scope so the two can
 * never disagree about a file the list shows but the download refuses.
 */
export async function reportFileReadScopeFor(
  fleetDb: BmsDb,
  user: ScopeUser,
): Promise<ReportFileReadScope> {
  if (user.role === "admin") {
    return { kind: "global" };
  }
  if (user.role === "organization_admin") {
    return { kind: "organization", organizationIds: await directOrganizationIds(fleetDb, user.id) };
  }
  // fleetDb: pre-tenant resolution keyed by the actor's own userId (ADR 0043 Amendment 2/3).
  const granted = await fleetDb
    .select({ id: locations.id, organizationId: locations.organizationId })
    .from(userLocationAccess)
    .innerJoin(locations, eq(userLocationAccess.locationId, locations.id))
    .where(eq(userLocationAccess.userId, user.id));
  // F2.10 / ADR 0098 decision 4: the readable set is the closure of the granted
  // nodes; the organizations are those of the granted rows (a descendant is in
  // its ancestor's organization by the composite foreign key), and they bound
  // the walk's anchor too (owner ruling P3).
  const organizationIds = [...new Set(granted.map((row) => row.organizationId))];
  return {
    kind: "location",
    organizationIds,
    locationIds: await expandLocationSubtrees(fleetDb, {
      organizationIds,
      ids: granted.map((row) => row.id),
    }),
  };
}

/**
 * Whether a scope covers a report file (`F3.5a`, ADR 0071 decision 6 /
 * Amendment 1 item 3): its readers are the users whose manage scope covers
 * its `location_ids`.
 *
 * - `global` reads everything.
 * - `organization` reads a file of an organization held directly.
 *   `canManageOrganization` is deliberately **not** used: for a
 *   `location_admin` it is location-derived, so it would admit a location
 *   admin to every file of an organization in which they hold one location.
 * - `location` reads a file only when `location_ids` is non-empty and
 *   **every** id is one they hold. The empty array means "the whole
 *   organization" — the shape an admin's or organization admin's save
 *   stamps (Amendment 1 item 2) — and that requires organization-level
 *   rights a location admin does not have. `every`, not `some`: a file
 *   covering two locations is readable only by someone who holds both.
 */
export function canReadReportFileFor(
  scope: ReportFileReadScope,
  file: { organizationId: string; locationIds: readonly string[] },
): boolean {
  if (scope.kind === "global") {
    return true;
  }
  if (scope.kind === "organization") {
    return scope.organizationIds.includes(file.organizationId);
  }
  // Step-5 security L1: the organization is checked here too. A location
  // id is unique fleet-wide, so a row that carries this admin's ids under a
  // foreign `organization_id` is one no honest writer produces — but the
  // verdict is the read gate, and it fails closed on the organization
  // rather than trusting the writer.
  const held = new Set(scope.locationIds);
  return (
    scope.organizationIds.includes(file.organizationId) &&
    file.locationIds.length > 0 &&
    file.locationIds.every((id) => held.has(id))
  );
}
