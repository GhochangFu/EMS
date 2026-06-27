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

/** Aggregates section-level KPIs for an accordion header. */
export function orgSectionSummary(locations: LocationKpiSummary[]): {
  locationCount: number;
  totalKw: number;
  openAlarms: number;
  freshLocationCount: number;
} {
  return {
    locationCount: locations.length,
    totalKw: locations.reduce((sum, location) => sum + location.totalKw, 0),
    openAlarms: locations.reduce((sum, location) => sum + location.openAlarms, 0),
    freshLocationCount: locations.filter((location) => location.freshAssetCount > 0)
      .length,
  };
}
