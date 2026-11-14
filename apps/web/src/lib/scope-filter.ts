import type {
  FilterOptionAsset,
  FilterOptionAssetGroup,
  FilterOptionOrganization,
  FilterOptionsResponse,
} from "@bms/shared/contracts";

import { locationTreeOptions, subtreeIds, type LocationTreeOption } from "./location-tree";

/**
 * `F4.361` (ADR 0132 decisions 5, 6 and 8; plan D10–D12) — the scope filter of `/alarms` and
 * `/rules`: Organization, Location (the node and its subtree), Asset group and Asset.
 *
 * Pure, so the cascade is proven without a router or a query. `useScopeFilter` reads the URL
 * through {@link readScopeFilter}, cleans it with {@link reconcileScopeFilter} once the options
 * arrive, and writes a user's change through {@link applyScopeChange}. Every id the server
 * receives only narrows (decision 5); this module keeps the URL to ids the options list, so a
 * stale or shared link never sends one the picker cannot show.
 */
export type ScopeFilter = {
  readonly organizationId?: string;
  readonly locationId?: string;
  readonly assetGroupId?: string;
  readonly assetId?: string;
};

export type ScopeFilterKey = keyof ScopeFilter;

/** The URL keys, parent first. They are also the API's query parameter names. */
export const SCOPE_FILTER_KEYS: readonly ScopeFilterKey[] = ["organizationId", "locationId", "assetGroupId", "assetId"];

/** The four keys as they stand in the URL; an empty value is absent, ids are lower-cased (decision 5). */
export function readScopeFilter(params: URLSearchParams): ScopeFilter {
  const out: { -readonly [K in ScopeFilterKey]?: string } = {};
  for (const key of SCOPE_FILTER_KEYS) {
    const value = params.get(key)?.trim().toLowerCase();
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

/** Whether any of the four keys is set. */
export function hasScope(filter: ScopeFilter): boolean {
  return SCOPE_FILTER_KEYS.some((key) => filter[key] !== undefined);
}

/** A copy of `params` with the four keys replaced by `filter`; every other parameter is kept. */
export function writeScopeFilter(params: URLSearchParams, filter: ScopeFilter): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of SCOPE_FILTER_KEYS) {
    const value = filter[key];
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
  }
  return next;
}

/** The one organization a caller reads, which is preselected and locked (D11); otherwise none. */
function lockedOrganizationId(options: FilterOptionsResponse): string | undefined {
  return options.organizations.length === 1 ? options.organizations[0].id : undefined;
}

/** The organization a child id belongs to, so a link naming only a child keeps working (D10). */
function organizationOfChild(filter: ScopeFilter, options: FilterOptionsResponse): string | undefined {
  return (
    options.locations.find((l) => l.id === filter.locationId)?.organizationId ??
    options.assetGroups.find((g) => g.id === filter.assetGroupId)?.organizationId ??
    options.assets.find((a) => a.id === filter.assetId)?.organizationId
  );
}

/**
 * The filter the URL and the request carry: every id the options list and its parents contain,
 * parent first. Unknown ids are dropped; a child without its organization gets it filled in (D10);
 * a single organization is never written (D11).
 */
export function reconcileScopeFilter(filter: ScopeFilter, options: FilterOptionsResponse): ScopeFilter {
  const locked = lockedOrganizationId(options);
  const named = filter.organizationId ?? organizationOfChild(filter, options);
  const organizationId = locked ?? options.organizations.find((o) => o.id === named)?.id;
  if (!organizationId) {
    return {};
  }
  const location = options.locations.find((l) => l.id === filter.locationId && l.organizationId === organizationId);
  const subtree = location ? subtreeIds(options.locations, location.id) : null;
  const group = options.assetGroups.find(
    (g) => g.id === filter.assetGroupId && g.organizationId === organizationId && (!subtree || subtree.has(g.locationId)),
  );
  const asset = options.assets.find(
    (a) =>
      a.id === filter.assetId &&
      a.organizationId === organizationId &&
      (!subtree || subtree.has(a.locationId)) &&
      (!group || group.assetIds.includes(a.id)),
  );
  return {
    ...(locked ? {} : { organizationId }),
    ...(location ? { locationId: location.id } : {}),
    ...(group ? { assetGroupId: group.id } : {}),
    ...(asset ? { assetId: asset.id } : {}),
  };
}

/**
 * A user's choice on one picker. `""` is that picker's "All …". The organization gates the rest,
 * so changing it clears every child; any other change keeps the children the new parent still
 * contains (decision 6).
 */
export function applyScopeChange(
  filter: ScopeFilter,
  key: ScopeFilterKey,
  value: string,
  options: FilterOptionsResponse,
): ScopeFilter {
  if (key === "organizationId") {
    return reconcileScopeFilter(value ? { organizationId: value } : {}, options);
  }
  const organizationId = filter.organizationId ?? lockedOrganizationId(options);
  return reconcileScopeFilter({ ...filter, organizationId, [key]: value || undefined }, options);
}

export type ScopeFilterChoices = {
  readonly organizations: readonly FilterOptionOrganization[];
  /** One organization: preselected and disabled (D11). */
  readonly organizationLocked: boolean;
  /** The organization the other pickers key off, `""` when none. */
  readonly organizationId: string;
  readonly locations: readonly LocationTreeOption[];
  readonly assetGroups: readonly FilterOptionAssetGroup[];
  readonly assets: readonly FilterOptionAsset[];
};

/** What each picker offers for the current filter. With no organization the other three are empty (D10). */
export function scopeFilterChoices(filter: ScopeFilter, options: FilterOptionsResponse): ScopeFilterChoices {
  const locked = lockedOrganizationId(options);
  const organizationId = locked ?? filter.organizationId ?? "";
  if (!organizationId) {
    return { organizations: options.organizations, organizationLocked: false, organizationId, locations: [], assetGroups: [], assets: [] };
  }
  const locations = options.locations.filter((l) => l.organizationId === organizationId);
  const subtree = filter.locationId ? subtreeIds(locations, filter.locationId) : null;
  const assetGroups = options.assetGroups.filter(
    (g) => g.organizationId === organizationId && (!subtree || subtree.has(g.locationId)),
  );
  const members = filter.assetGroupId ? options.assetGroups.find((g) => g.id === filter.assetGroupId)?.assetIds ?? [] : null;
  const assets = options.assets.filter(
    (a) =>
      a.organizationId === organizationId &&
      (!subtree || subtree.has(a.locationId)) &&
      (!members || members.includes(a.id)),
  );
  return {
    organizations: options.organizations,
    organizationLocked: locked !== undefined,
    organizationId,
    locations: locationTreeOptions(locations),
    assetGroups,
    assets,
  };
}
