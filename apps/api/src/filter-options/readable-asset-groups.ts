import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";

import { assetGroups } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { AccessibleScope } from "@bms/shared";

/**
 * `F4.361` (ADR 0132 build note 1, plan Q1) — which asset groups a caller
 * **reads**. `currentUser(jwt).scope.assetGroups` lists groups only for an
 * asset-group grant, so on its own it would leave the picker empty for every
 * organization- or location-scoped caller and for the global admin. The rule:
 * a group is readable when it is one of the caller's granted groups, **or**
 * its location is one of the caller's readable locations. This one function
 * decides it for the options read (`FilterOptionsService`) and for the list
 * filters (`AssetFilterScopeService.narrow`).
 */
export type AssetGroupReadScope = {
  /** The caller's granted groups (`scope.assetGroups` — non-empty only for an asset-group grant). */
  readonly grantedGroupIds: readonly string[];
  /** The caller's readable location ids; `null` is the unrestricted admin (every group). */
  readonly locationIds: readonly string[] | null;
};

export type ReadableAssetGroupRow = {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly locationId: string;
  readonly organizationId: string;
};

/**
 * The two sets of a resolved `AccessibleScope`. Plan Q1 splits by grant
 * kind: an **asset-group** scope reads its granted groups only — its
 * `locations` are the groups' own sites, listed so the tree can render, and
 * reading every group there would hand a group admin the other groups on its
 * site (build note 4). Every **other** scope reads the groups at its readable
 * locations (its `assetGroups` is empty).
 */
export function assetGroupReadScope(
  scope: Pick<AccessibleScope, "kind" | "assetGroups" | "locations">,
): AssetGroupReadScope {
  if (scope.kind === "asset_group") {
    return { grantedGroupIds: scope.assetGroups.map((group) => group.id), locationIds: [] };
  }
  return { grantedGroupIds: [], locationIds: scope.locations.map((location) => location.id) };
}

/**
 * The groups `scope` reads, by name — or, with `onlyId`, that one group when it
 * is readable and nothing otherwise (build note 4: an unreadable group answers
 * empty, checked before any member is read).
 *
 * §4.3 fleet read, by name: this is **pre-tenant scope resolution** across the
 * caller's organizations — a location- or organization-scoped caller may span
 * several, and a single tenant GUC would hide the rest. Every row is bounded by
 * ids from the caller's own resolved scope (granted groups, readable
 * locations), never by a request alone; only the unrestricted admin
 * (`locationIds` null) reads without that bound, as `readableAssetIds` does.
 */
export async function readableAssetGroups(
  fleetDb: Pick<BmsDb, "select">,
  scope: AssetGroupReadScope,
  onlyId?: string,
): Promise<ReadableAssetGroupRow[]> {
  let readable: SQL | undefined;
  if (scope.locationIds !== null) {
    const arms = [
      ...(scope.grantedGroupIds.length > 0 ? [inArray(assetGroups.id, [...scope.grantedGroupIds])] : []),
      ...(scope.locationIds.length > 0 ? [inArray(assetGroups.locationId, [...scope.locationIds])] : []),
    ];
    if (arms.length === 0) return [];
    readable = or(...arms);
  }
  return fleetDb
    .select({
      id: assetGroups.id,
      name: assetGroups.name,
      code: assetGroups.code,
      locationId: assetGroups.locationId,
      organizationId: assetGroups.organizationId,
    })
    .from(assetGroups)
    .where(and(onlyId !== undefined ? eq(assetGroups.id, onlyId) : undefined, readable))
    .orderBy(asc(assetGroups.name), asc(assetGroups.id));
}
