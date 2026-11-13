import { eq, inArray, sql, type SQL } from "drizzle-orm";

import { assets, locations, maintenanceWindows } from "@bms/db";
import type { AccessibleScope, JwtPayload } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";

import { expandLocationSubtrees, locationAncestorChains, locationAncestors } from "../auth/location-tree";
import type { BmsTx } from "../database/tenant-context";

/**
 * `F4.359` U3 (ADR 0131 decisions 13 and 14, plan D15, D16) — who reads a
 * maintenance window, who may change it, and the list's filters.
 *
 * Every walk here goes through `auth/location-tree.ts`; this file writes no
 * recursive CTE of its own (`tests/f2.10-recursive-cte-invariants.test.ts`).
 */

/**
 * The caller's readable sets, as `AccessControlService` answers them. Every
 * set is `null` for the unrestricted admin and never `null` for anyone else.
 *
 * `subtreeLocationIds` is the set a **location target** is checked against
 * (ADR 0131 decision 4, review finding 1). A location target silences every
 * asset at or under the node, so naming it needs the whole subtree, not one
 * readable node. The rule: a location may be named when the caller is
 * unrestricted, or when its read scope is **location- or
 * organization-sourced** (`AccessibleScope.kind === "location"`) and the node
 * is in that scope's locations. Both sources resolve the subtree closure of
 * their grant (an organization grant is every node of the organization), so a
 * node in the set is a node whose subtree the caller reads. An
 * **asset-group-sourced** scope names its groups' locations in `locationIds`
 * while it reads only the member assets there, so it may name no location
 * target at all: `subtreeLocationIds` is `[]` for it.
 *
 * Accepted edge (security re-review L-b): the scope sources list active nodes
 * only, while the cover walks the whole subtree, so a location target also
 * reaches an inactive descendant (ADR 0098: only a leaf subtree can be
 * inactive under an active node). Accepted: a grant over a node owns its
 * inactive descendants.
 */
export type MaintenanceWindowReadScope = {
  readonly assetIds: readonly string[] | null;
  readonly locationIds: readonly string[] | null;
  readonly organizationIds: readonly string[] | null;
  readonly subtreeLocationIds: readonly string[] | null;
};

/** The admin's scope: every set unrestricted. */
export const UNRESTRICTED_SCOPE: MaintenanceWindowReadScope = {
  assetIds: null,
  locationIds: null,
  organizationIds: null,
  subtreeLocationIds: null,
};

/** The admin's scope is unrestricted; `readableAssetIds` is `null` for that role alone. */
export function isUnrestricted(scope: MaintenanceWindowReadScope): boolean {
  return scope.assetIds === null;
}

/**
 * A scoped caller's `AccessibleScope` (the one `/auth/me` answers) as the
 * window scope. Only a `location`-kind scope — organization- or
 * location-sourced — names locations whose whole subtree it reads (see
 * `MaintenanceWindowReadScope`).
 */
export function scopedReadScope(scope: AccessibleScope, organizationIds: readonly string[]): MaintenanceWindowReadScope {
  const locationIds = scope.locations.map((location) => location.id);
  return {
    assetIds: scope.assetIds,
    locationIds,
    organizationIds,
    subtreeLocationIds: scope.kind === "location" ? locationIds : [],
  };
}

/**
 * The caller's window scope, read from `AccessControlService` (the controller's
 * and the integration claims' one path). The admin is decided on the role, as
 * `readableAssetIds` decides it, before any scope walk. Everyone else is one
 * `currentUser` (its `AccessibleScope` carries the grant source's `kind`, which
 * `readableLocationIds` drops) and one `readableOrganizationIds`.
 */
export async function readScopeFor(
  access: Pick<AccessControlService, "isGlobalAdmin" | "currentUser" | "readableOrganizationIds">,
  jwt: JwtPayload,
): Promise<MaintenanceWindowReadScope> {
  if (await access.isGlobalAdmin(jwt)) return UNRESTRICTED_SCOPE;
  const { scope } = await access.currentUser(jwt);
  return scopedReadScope(scope, (await access.readableOrganizationIds(jwt)) ?? []);
}

/** A target as the write path resolved it from the database (the rule's asset is the rule row's). */
export type ResolvedTarget =
  | { readonly kind: "asset"; readonly id: string; readonly organizationId: string }
  | { readonly kind: "location"; readonly id: string; readonly organizationId: string }
  | { readonly kind: "rule"; readonly id: string; readonly organizationId: string; readonly assetId: string | null };

/**
 * Whether the caller may name this target on a write: an asset it reads; a
 * rule whose asset it reads; a location whose whole subtree it reads
 * (`subtreeLocationIds`, see `MaintenanceWindowReadScope`). Owner ruling P2
 * still holds — a location above the grant is refused even when the caller
 * reads an asset under it (plan claim 4). The admin may name any.
 */
export function targetInScope(target: ResolvedTarget, scope: MaintenanceWindowReadScope): boolean {
  if (isUnrestricted(scope)) return true;
  const assetIds = scope.assetIds ?? [];
  switch (target.kind) {
    case "asset":
      return assetIds.includes(target.id);
    case "rule":
      return target.assetId !== null && assetIds.includes(target.assetId);
    case "location":
      return (scope.subtreeLocationIds ?? []).includes(target.id);
  }
}

/**
 * D15: extend, end and cancel need **every** target of the window inside the
 * caller's scope — a site admin must not end a window that also covers another
 * site. A window with no target is refused: `every` of nothing would pass.
 */
export function everyTargetInScope(targets: readonly ResolvedTarget[], scope: MaintenanceWindowReadScope): boolean {
  return targets.length > 0 && targets.every((target) => targetInScope(target, scope));
}

/** A stored target as the list reads it: a rule carries its asset. */
export type StoredTarget =
  | { readonly kind: "asset"; readonly id: string }
  | { readonly kind: "location"; readonly id: string }
  | { readonly kind: "rule"; readonly id: string; readonly assetId: string | null };

/**
 * Review finding 2: which of a visible window's targets the caller may see
 * (id and label). An asset it reads, a rule on such an asset, a location in
 * its subtree grant (`subtreeLocationIds`) — never an ancestor that only
 * makes the window visible. `visibleLocations === null` is the admin: all.
 */
export function targetVisibleTo(target: StoredTarget, scope: MaintenanceWindowReadScope, visibleLocations: readonly string[] | null): boolean {
  if (isUnrestricted(scope) || visibleLocations === null) return true;
  const assetIds = scope.assetIds ?? [];
  switch (target.kind) {
    case "asset":
      return assetIds.includes(target.id);
    case "rule":
      return target.assetId !== null && assetIds.includes(target.assetId);
    case "location":
      // Security re-review M1: only a location the caller reads whole (its
      // subtree grant). An ancestor that merely makes the window visible
      // (`visibleLocations`) is not disclosed: /auth/me hides it too (ADR 0098).
      return (scope.subtreeLocationIds ?? []).includes(target.id);
  }
}

/**
 * The location targets a scoped caller sees a window through: its readable
 * locations, and every ancestor-or-self of a readable asset's location (a
 * window on site S covers the asset at child C the caller reads). `null` for
 * the admin.
 *
 * Runs inside the list's read-scope transaction: under `withTenant` the walk is
 * bounded by RLS as well as by `organizationIds`; in the fleet branch by
 * `organizationIds` alone, which is the caller's own readable set (server
 * authorized, `TreeAnchors`).
 */
export async function visibleLocationIds(tx: BmsTx, scope: MaintenanceWindowReadScope): Promise<string[] | null> {
  if (isUnrestricted(scope)) return null;
  const assetIds = scope.assetIds ?? [];
  const organizationIds = scope.organizationIds ?? [];
  const nodes =
    assetIds.length === 0
      ? []
      : (
          await tx
            .selectDistinct({ locationId: assets.locationId })
            .from(assets)
            .where(inArray(assets.id, [...assetIds]))
        ).map((row) => row.locationId);
  const chains = await locationAncestorChains(tx, { organizationIds, ids: nodes });
  return [...new Set([...(scope.locationIds ?? []), ...chains.map((link) => link.ancestorId)])];
}

/**
 * The visibility predicate on `bms.maintenance_windows`: one of the window's
 * targets is an asset the caller reads, a rule on such an asset, or a location
 * in `locationIds` (`visibleLocationIds`). Two empty sets read nothing.
 */
export function windowVisibleTo(assetIds: readonly string[], locationIds: readonly string[]): SQL {
  const a = sql.param([...assetIds]);
  const l = sql.param([...locationIds]);
  return sql`EXISTS (SELECT 1 FROM bms.maintenance_window_targets t
     WHERE t.window_id = ${maintenanceWindows.id}
       AND (t.asset_id = ANY(${a}::uuid[])
         OR t.location_id = ANY(${l}::uuid[])
         OR t.rule_id IN (SELECT r.id FROM bms.automation_rules r WHERE r.asset_id = ANY(${a}::uuid[]))))`;
}

/** D2, on the database clock: future, active, past. One rule for the route, the raiser and the list. */
export const windowStateSql: SQL<"active" | "future" | "past"> = sql`CASE
  WHEN ${maintenanceWindows.endedAt} IS NULL AND ${maintenanceWindows.startsAt} > now() THEN 'future'
  WHEN ${maintenanceWindows.endedAt} IS NULL AND ${maintenanceWindows.endsAt} > now() THEN 'active'
  ELSE 'past' END`;

/**
 * The clock half of an open window's state (D2): `future` has not started,
 * `active` has started and not reached its end. The write guards AND this onto
 * `ended_at IS NULL` themselves, so that guard stays visible at each `UPDATE`.
 */
export function windowClockIs(state: "active" | "future"): SQL {
  return state === "future"
    ? sql`${maintenanceWindows.startsAt} > now()`
    : sql`(${maintenanceWindows.startsAt} <= now() AND ${maintenanceWindows.endsAt} > now())`;
}

/** The list's state filter, on the database clock (D2). */
export function windowInState(state: "active" | "future" | "past"): SQL {
  if (state === "past") {
    return sql`(${maintenanceWindows.endedAt} IS NOT NULL OR ${maintenanceWindows.endsAt} <= now())`;
  }
  return sql`(${maintenanceWindows.endedAt} IS NULL AND ${windowClockIs(state)})`;
}

/** An `assetId` filter resolved: the asset, and the ancestor-or-self locations a location target covers it through. */
export type AssetFilter = { readonly assetId: string; readonly coverLocationIds: readonly string[] };

/**
 * `assetId=`: P2 first (a scoped caller who cannot read the asset gets
 * nothing, before any walk), then the asset's location and its ancestors.
 * `null` = the read is empty. The asset's own organization bounds the walk.
 */
export async function resolveAssetFilter(tx: BmsTx, scope: MaintenanceWindowReadScope, assetId: string): Promise<AssetFilter | null> {
  if (!isUnrestricted(scope) && !(scope.assetIds ?? []).includes(assetId)) return null;
  const [asset] = await tx
    .select({ locationId: assets.locationId, organizationId: assets.organizationId })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) return null;
  const chain = await locationAncestors(tx, { organizationIds: [asset.organizationId], id: asset.locationId });
  return { assetId, coverLocationIds: chain.map((link) => link.id) };
}

/** The window covers the asset: as an asset target, through a rule on it, or through a location target above it. */
export function windowCoversAsset(filter: AssetFilter): SQL {
  const l = sql.param([...filter.coverLocationIds]);
  return sql`EXISTS (SELECT 1 FROM bms.maintenance_window_targets t
     WHERE t.window_id = ${maintenanceWindows.id}
       AND (t.asset_id = ${filter.assetId}
         OR t.location_id = ANY(${l}::uuid[])
         OR t.rule_id IN (SELECT r.id FROM bms.automation_rules r WHERE r.asset_id = ${filter.assetId})))`;
}

/** A `locationId` filter resolved: the node's subtree and its ancestors (each includes the node). */
export type LocationFilter = { readonly subtreeIds: readonly string[]; readonly ancestorIds: readonly string[] };

/**
 * `locationId=`: P2 first (the alarm list's rule: a scoped caller who cannot
 * read the node gets nothing, before any walk), then the subtree and the
 * ancestors of the node, bounded by the node's own organization. `null` = the
 * read is empty.
 */
export async function resolveLocationFilter(tx: BmsTx, scope: MaintenanceWindowReadScope, locationId: string): Promise<LocationFilter | null> {
  if (!isUnrestricted(scope) && !(scope.locationIds ?? []).includes(locationId)) return null;
  const [node] = await tx
    .select({ organizationId: locations.organizationId })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  if (!node) return null;
  const organizationIds = [node.organizationId];
  const subtreeIds = await expandLocationSubtrees(tx, { organizationIds, ids: [locationId] });
  const ancestors = await locationAncestors(tx, { organizationIds, id: locationId });
  return { subtreeIds, ancestorIds: ancestors.map((link) => link.id) };
}

/**
 * The window touches the node: a location target at, above or below it, or an
 * asset target (or a rule on an asset) at or below it.
 */
export function windowTouchesLocation(filter: LocationFilter): SQL {
  const nodes = sql.param([...new Set([...filter.subtreeIds, ...filter.ancestorIds])]);
  const subtree = sql.param([...filter.subtreeIds]);
  return sql`EXISTS (SELECT 1 FROM bms.maintenance_window_targets t
     WHERE t.window_id = ${maintenanceWindows.id}
       AND (t.location_id = ANY(${nodes}::uuid[])
         OR t.asset_id IN (SELECT a.id FROM bms.assets a WHERE a.location_id = ANY(${subtree}::uuid[]))
         OR t.rule_id IN (SELECT r.id FROM bms.automation_rules r JOIN bms.assets a ON a.id = r.asset_id
                           WHERE a.location_id = ANY(${subtree}::uuid[]))))`;
}
