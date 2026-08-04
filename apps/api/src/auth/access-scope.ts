import type { AccessibleScope, UserRole } from "@bms/shared";

/**
 * Where a role's *read* scope is resolved from.
 *
 * - `global` — every active location and asset (global admin only).
 * - `organization` — `bms.user_organization_access` grants.
 * - `location` — `bms.user_location_access` grants.
 * - `asset_group` — `bms.user_asset_group_access` grants.
 * - `none` — fail closed: no locations, no asset groups, no assets.
 */
export type ReadScopeSource =
  | "global"
  | "organization"
  | "location"
  | "asset_group"
  | "none";

/**
 * Empty, fail-closed scope used when no grant source yields access.
 *
 * Returned as a fresh object per call so one request's scope can never alias
 * (or be mutated into) another's.
 */
export function noAccessScope(): AccessibleScope {
  return { kind: "none", locations: [], assetGroups: [], assetIds: [] };
}

/**
 * Grant sources a role's read scope is resolved from, in precedence order.
 *
 * The first source that yields any location or asset wins; if none does the
 * caller falls back to the last entry, so a role whose list ends in `none`
 * fails closed rather than exposing an empty-but-permissive scope kind.
 *
 * `operator` reads whatever its explicit organization/location/asset-group
 * grants allow. Without any grant row it resolves to `none` — access is never
 * inferred, only granted, and there is no organization column on `bms.users`
 * from which a non-cross-organization default could be derived.
 *
 * `viewer` deliberately stays at `none` for now. The operations mutation
 * endpoints (alarm acknowledge, rule create/publish/enable, work orders,
 * maintenance) carry no role gate at all — they authorize purely on the read
 * scope this function feeds, rejecting only when it is empty. Widening
 * `viewer` here would therefore also hand it write access, so it waits on a
 * write gate for those endpoints (F4.11 follow-up). Do not flip this line
 * without adding one.
 */
export function readScopeSourcesForRole(role: UserRole): ReadScopeSource[] {
  switch (role) {
    case "admin":
      return ["global"];
    case "organization_admin":
      return ["organization"];
    case "location_admin":
      return ["location"];
    case "asset_group_admin":
      return ["asset_group"];
    case "operator":
      return ["organization", "location", "asset_group", "none"];
    case "viewer":
      return ["none"];
    default:
      return ["none"];
  }
}

/**
 * Whether the role may reach master-data administration (write) endpoints.
 *
 * `operator`, `viewer` and `asset_group_admin` are excluded on purpose —
 * widening a role's read scope must never widen its master-data write scope.
 */
export function isMasterDataRole(role: UserRole): boolean {
  return (
    role === "admin" ||
    role === "organization_admin" ||
    role === "location_admin"
  );
}
