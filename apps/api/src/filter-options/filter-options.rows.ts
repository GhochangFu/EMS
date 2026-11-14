import type { FilterOptionsResponse } from "@bms/shared";

import type { ReadableAssetGroupRow } from "./readable-asset-groups";

/**
 * `F4.361` U3 — the rows `FilterOptionsService` read, before assembly. Each
 * list is already bounded by the caller's scope and to active rows where the
 * table has the column; what is left to decide is how they fit together.
 */
export type FilterOptionRows = {
  readonly organizations: FilterOptionsResponse["organizations"];
  readonly locations: FilterOptionsResponse["locations"];
  readonly assetGroups: readonly ReadableAssetGroupRow[];
  readonly members: readonly { readonly assetGroupId: string; readonly assetId: string }[];
  readonly assets: FilterOptionsResponse["assets"];
};

/**
 * `GET /filter-options` from its rows (ADR 0132 decision 2, plan D9), pure so
 * the drops are tested without a `Pool` (§4.3):
 *
 * - a location is listed only when its organization is;
 * - a `parentId` that is not a listed location is `null` — masked **after**
 *   the last filter, so no id of an unlisted node leaks (ADR 0098 Drafter
 *   choice 8, as `/me` does);
 * - a group and an asset are listed only at a listed location;
 * - a group's `assetIds` are its members that the answer lists (build note 2).
 *
 * Input order is kept.
 */
export function buildFilterOptions(rows: FilterOptionRows): FilterOptionsResponse {
  const organizationIds = new Set(rows.organizations.map((organization) => organization.id));
  const kept = rows.locations.filter((location) => organizationIds.has(location.organizationId));
  const locationIds = new Set(kept.map((location) => location.id));
  const locations = kept.map((location) => ({
    id: location.id,
    name: location.name,
    code: location.code,
    parentId: location.parentId !== null && locationIds.has(location.parentId) ? location.parentId : null,
    organizationId: location.organizationId,
  }));
  const assets = rows.assets
    .filter((asset) => locationIds.has(asset.locationId))
    .map((asset) => ({
      id: asset.id,
      code: asset.code,
      name: asset.name,
      locationId: asset.locationId,
      organizationId: asset.organizationId,
    }));
  const assetIds = new Set(assets.map((asset) => asset.id));
  const membersOf = new Map<string, string[]>();
  for (const member of rows.members) {
    if (!assetIds.has(member.assetId)) continue;
    const list = membersOf.get(member.assetGroupId) ?? [];
    list.push(member.assetId);
    membersOf.set(member.assetGroupId, list);
  }
  const assetGroups = rows.assetGroups
    .filter((group) => locationIds.has(group.locationId))
    .map((group) => ({
      id: group.id,
      name: group.name,
      code: group.code,
      locationId: group.locationId,
      organizationId: group.organizationId,
      assetIds: membersOf.get(group.id) ?? [],
    }));
  return {
    organizations: rows.organizations.map((organization) => ({ id: organization.id, code: organization.code, name: organization.name })),
    locations,
    assetGroups,
    assets,
  };
}
