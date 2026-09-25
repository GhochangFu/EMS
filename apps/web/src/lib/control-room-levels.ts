import type { LocationKpiSummary, OrganizationRef } from "@bms/shared";

import { groupByOrganization, orgSectionSummary } from "./location-kpi-groups";

/**
 * `F3.66` (ADR 0076 decisions 1–2) — the three Control Room levels and the
 * level-skip rule (D1): a level that holds one item is skipped, decided only
 * from a resolved KPI list (never from `[]` while the read is pending — the
 * caller owns that guard, D1).
 */
export type ControlRoomTarget =
  | { level: "organizations" }
  | { level: "organization"; organizationId: string }
  | { level: "site"; locationId: string }
  | { level: "empty" };

export type OrganizationCard = {
  organization: OrganizationRef;
  siteCount: number;
  sitesOnline: number;
  openAlarms: number;
};

export type Crumb = { label: string; to?: string };

/** One card per readable organization, for `/control-room` (`O1`/`O2`). */
export function organizationCards(
  items: readonly LocationKpiSummary[],
): OrganizationCard[] {
  return groupByOrganization([...items]).map((group) => {
    const summary = orgSectionSummary(group.locations);
    return {
      organization: group.organization,
      siteCount: summary.locationCount,
      sitesOnline: summary.freshLocationCount,
      openAlarms: summary.openAlarms,
    };
  });
}

/** Where `/control-room` lands: skip to the organization or the site when
 * there is only one to show (D1). */
export function controlRoomEntryTarget(
  items: readonly LocationKpiSummary[],
): ControlRoomTarget {
  if (items.length === 0) {
    return { level: "empty" };
  }
  const organizationIds = new Set(items.map((item) => item.organization.id));
  if (organizationIds.size > 1) {
    return { level: "organizations" };
  }
  if (items.length > 1) {
    return { level: "organization", organizationId: items[0].organization.id };
  }
  return { level: "site", locationId: items[0].id };
}

/** Where `/control-room/org/:organizationId` lands: skip to the site when
 * the organization holds exactly one readable site (D1). */
export function organizationEntryTarget(
  items: readonly LocationKpiSummary[],
  organizationId: string,
): ControlRoomTarget {
  const sites = items.filter((item) => item.organization.id === organizationId);
  if (sites.length === 0) {
    return { level: "empty" };
  }
  if (sites.length > 1) {
    return { level: "organization", organizationId };
  }
  return { level: "site", locationId: sites[0].id };
}

/**
 * The breadcrumb trail for the level `at` names, omitting a crumb for every
 * level the skip rule bypassed (D2). The organization crumb shows only when
 * that organization's own level is not skipped: there is more than one
 * organization (so `/control-room` lists them) and that organization holds
 * more than one site (so its page does not redirect to the site). The site
 * crumb shows whenever the path above it was not skipped as a whole — only a
 * scope of one organization with one site lands on the site straight from
 * `/control-room`. So a one-site organization among several gives
 * `Control Room / <site>`. The last crumb carries no `to`: it names the current
 * page. `ControlRoomBreadcrumb` renders nothing for a one-crumb list.
 */
export function controlRoomCrumbs(
  items: readonly LocationKpiSummary[],
  at: { organizationId?: string; locationId?: string },
): Crumb[] {
  const organizationIds = new Set(items.map((item) => item.organization.id));
  const site = at.locationId
    ? items.find((item) => item.id === at.locationId)
    : undefined;
  const organizationId = site?.organization.id ?? at.organizationId;
  const organizationSites = organizationId
    ? items.filter((item) => item.organization.id === organizationId)
    : [];
  const organizationsLevelShown = organizationIds.size > 1;
  const organizationLevelShown = organizationSites.length > 1;

  const crumbs: Crumb[] = [{ label: "Control Room", to: "/control-room" }];

  if (organizationsLevelShown && organizationLevelShown) {
    const organization = organizationSites[0].organization;
    crumbs.push({
      label: organization.name,
      to: `/control-room/org/${organization.id}`,
    });
  }

  if (site && (organizationsLevelShown || organizationLevelShown)) {
    crumbs.push({ label: site.name, to: `/control-room/site/${site.id}` });
  }

  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}
