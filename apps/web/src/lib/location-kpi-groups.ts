import type { LocationKpiSummary, OrganizationRef } from "@bms/shared";

export type OrgFilter = "all" | string;

export type OrganizationLocationGroup = {
  organization: OrganizationRef;
  locations: LocationKpiSummary[];
};

/** Returns unique organizations from location KPI rows, sorted by code. */
export function distinctOrganizations(
  items: LocationKpiSummary[],
): OrganizationRef[] {
  const byId = new Map<string, OrganizationRef>();
  for (const item of items) {
    byId.set(item.organization.id, item.organization);
  }
  return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Filters locations by organization code; `all` returns the full list. */
export function filterByOrganization(
  items: LocationKpiSummary[],
  filter: OrgFilter,
): LocationKpiSummary[] {
  if (filter === "all") {
    return items;
  }
  return items.filter((item) => item.organization.code === filter);
}

/** Groups locations by organization, sorted by org code. */
export function groupByOrganization(
  items: LocationKpiSummary[],
): OrganizationLocationGroup[] {
  const groups = new Map<string, OrganizationLocationGroup>();
  for (const location of items) {
    const existing = groups.get(location.organization.id);
    if (existing) {
      existing.locations.push(location);
    } else {
      groups.set(location.organization.id, {
        organization: location.organization,
        locations: [location],
      });
    }
  }
  return [...groups.values()]
    .sort((a, b) => a.organization.code.localeCompare(b.organization.code))
    .map((group) => ({
      ...group,
      locations: [...group.locations].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * `F4.259` — a site is live when at least one of its assets reports fresh telemetry. The one
 * rule behind the card's Live badge, the Control Room's live and not-live groups and
 * `freshLocationCount`.
 */
export function hasLiveTelemetry(location: LocationKpiSummary): boolean {
  return location.freshAssetCount > 0;
}

/**
 * `F4.375` (ADR 0133 Amendment 2 rulings Q5, Q7) — some location shows energy. The organization
 * page reads it over its own sites to decide whether a kW-only strip tile and the load card are
 * drawn. `false` for an empty list.
 */
export function anyEnergyShown(locations: readonly LocationKpiSummary[]): boolean {
  return locations.some((location) => location.energyShown);
}

/** `F4.259` — the sites split into live and not live, each list keeping the input order. */
export function splitByLiveTelemetry(locations: readonly LocationKpiSummary[]): {
  live: LocationKpiSummary[];
  notLive: LocationKpiSummary[];
} {
  return {
    live: locations.filter(hasLiveTelemetry),
    notLive: locations.filter((location) => !hasLiveTelemetry(location)),
  };
}

/**
 * `F4.261` — the live share of `live + notLive` sites, rounded to a whole percent; 0 with no
 * site. The status strip and the chips both read it.
 */
export function livePercent(live: number, notLive: number): number {
  const total = live + notLive;
  return total > 0 ? Math.round((live / total) * 100) : 0;
}

/**
 * Aggregates section-level KPIs for an accordion header. `F4.364` (plan ruling Q4): `totalKw` sums
 * the numbers over the locations that show energy, and is `null` when none of them has one.
 *
 * `F4.240` (ADR 0139 decision 16, plan D11) — `locationCount` and `freshLocationCount` count
 * **sites** (`siteLocations`), so a parent that holds no asset is not counted beside its children.
 * A flat list is all sites, so it counts as before. `totalKw` and `openAlarms` read every item: an
 * asset-less parent adds no kW and no alarm, and a parent that holds assets is a site.
 */
export function orgSectionSummary(locations: LocationKpiSummary[]): {
  locationCount: number;
  totalKw: number | null;
  openAlarms: number;
  freshLocationCount: number;
} {
  const sites = siteLocations(locations);
  return {
    locationCount: sites.length,
    totalKw: sectionKw(locations),
    openAlarms: locations.reduce((sum, location) => sum + location.openAlarms, 0),
    freshLocationCount: sites.filter(hasLiveTelemetry).length,
  };
}

/**
 * `F4.240` (ADR 0139 decisions 13 and 16, plan D11) — the items that are **sites**: an item that
 * holds an asset, or that no other item names as its `parentId` (a leaf: the map's `PIN_RULE`
 * read on the KPI items). An asset-less parent is not a site: it draws no card and is not counted.
 * Keeps the input order.
 */
export function siteLocations(items: readonly LocationKpiSummary[]): LocationKpiSummary[] {
  const parentIds = new Set(items.flatMap((item) => (item.parentId === null ? [] : [item.parentId])));
  return items.filter((item) => item.assetCount > 0 || !parentIds.has(item.id));
}

/** `F4.240` — one parent header and the site cards under it. */
export type SiteCardGroup = {
  parent: LocationKpiSummary;
  /** The parent's own card first when it is a site, then its child sites in the input order. */
  sites: LocationKpiSummary[];
};

/** `F4.240` — the groups, in their parents' input order, and the sites no header files. */
export type GroupedSites = {
  groups: SiteCardGroup[];
  loose: LocationKpiSummary[];
};

/**
 * `F4.240` (ADR 0139 decision 13, plan D11) — files each site under its nearest readable parent
 * (its `parentId`, when that parent is in `items`; the API nulls an unreadable one). A parent
 * with no site under it draws no header. A parent that is itself a site heads its own group, its
 * card first, and is not filed again under its own parent (a tree deeper than two levels is not
 * nested: section 1 of the plan). Every other site is loose and renders as today, so a list with
 * no tree is all loose, in the input order. No code names a level or an organization.
 */
export function groupSitesByParent(items: readonly LocationKpiSummary[]): GroupedSites {
  const readable = new Set(items.map((item) => item.id));
  const sites = siteLocations(items);
  const childrenByParent = new Map<string, LocationKpiSummary[]>();
  for (const site of sites) {
    if (site.parentId !== null && readable.has(site.parentId)) {
      const children = childrenByParent.get(site.parentId) ?? [];
      children.push(site);
      childrenByParent.set(site.parentId, children);
    }
  }
  const siteIds = new Set(sites.map((site) => site.id));
  const groups: SiteCardGroup[] = [];
  for (const item of items) {
    const children = (childrenByParent.get(item.id) ?? []).filter((child) => !childrenByParent.has(child.id));
    if (childrenByParent.has(item.id)) {
      const own = siteIds.has(item.id) ? [item] : [];
      if (own.length + children.length > 0) {
        groups.push({ parent: item, sites: [...own, ...children] });
      }
    }
  }
  const grouped = new Set(groups.flatMap((group) => group.sites.map((site) => site.id)));
  return { groups, loose: sites.filter((site) => !grouped.has(site.id)) };
}

/**
 * `F4.240` (ADR 0139 decision 15) — Live and Not live hold groups: a group is live when at least
 * one of its sites is live, and moves whole; each card keeps its own badge. Loose sites split by
 * their own state, as `splitByLiveTelemetry` does. Both keep the input order.
 */
export function splitGroupsByLive(grouped: GroupedSites): { live: GroupedSites; notLive: GroupedSites } {
  const liveGroup = (group: SiteCardGroup) => group.sites.some(hasLiveTelemetry);
  const loose = splitByLiveTelemetry(grouped.loose);
  return {
    live: { groups: grouped.groups.filter(liveGroup), loose: loose.live },
    notLive: { groups: grouped.groups.filter((group) => !liveGroup(group)), loose: loose.notLive },
  };
}

/** `F4.240` (ADR 0139 decision 14, plan D12) — a header's roll-up over its group's sites. */
export function siteGroupRollup(group: SiteCardGroup): {
  liveSites: number;
  sites: number;
  assets: number;
  alarms: number;
} {
  return {
    liveSites: group.sites.filter(hasLiveTelemetry).length,
    sites: group.sites.length,
    assets: group.sites.reduce((sum, site) => sum + site.assetCount, 0),
    alarms: group.sites.reduce((sum, site) => sum + site.openAlarms, 0),
  };
}

function sectionKw(locations: readonly LocationKpiSummary[]): number | null {
  const values = locations.flatMap((location) =>
    location.energyShown && location.totalKw !== null ? [location.totalKw] : [],
  );
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}
