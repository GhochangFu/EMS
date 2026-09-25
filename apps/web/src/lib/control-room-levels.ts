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
 * level the skip rule bypassed (D2) — a skipped organization level never gets
 * a crumb, and neither does a skipped site level. The last crumb carries no
 * `to`: it names the current page. `AdminBreadcrumb` renders nothing for a
 * one-crumb list.
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

  const crumbs: Crumb[] = [{ label: "Control Room", to: "/control-room" }];

  if (organizationId && organizationIds.size > 1) {
    const organization = items.find(
      (item) => item.organization.id === organizationId,
    )?.organization;
    if (organization) {
      crumbs.push({
        label: organization.name,
        to: `/control-room/org/${organizationId}`,
      });
    }
  }

  if (site) {
    const siteCount = items.filter(
      (item) => item.organization.id === site.organization.id,
    ).length;
    if (siteCount > 1) {
      crumbs.push({ label: site.name, to: `/control-room/site/${site.id}` });
    }
  }

  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}
