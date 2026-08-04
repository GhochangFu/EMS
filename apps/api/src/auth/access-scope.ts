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
 * `viewer` now reads from the same grant sources. It was previously held at
 * `none` because the operations mutation endpoints (alarm acknowledge, rule
 * create/publish/enable, work orders, maintenance) carried no role gate at all
 * — they authorized purely on the read scope this function feeds, so widening
 * `viewer` here would also have handed it write access.
 *
 * ADR 0017 added that gate (`AccessControlService.assertOperationsWriteRole`,
 * applied to all 15 mutating handlers), which decouples reading from writing.
 * Read scope is no longer load-bearing for authorization, so `viewer` can read
 * what it is granted while writing nothing.
 *
 * If you ever remove the write gate, this line must go back to `["none"]`.
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
      return ["organization", "location", "asset_group", "none"];
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
