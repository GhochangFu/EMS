import { expect } from "vitest";

import type { JwtPayload } from "@bms/shared";

import type { DashboardsService } from "./dashboards.service";

/**
 * `F3.72` U0 — `GET /dashboards?locationId=` (plan D8, OQ6).
 *
 * A dashboard matches a location when its `location_id` IS that location, or its
 * `asset_group_id` is a group OF that location (`bms.asset_groups.location_id`).
 * The filter narrows within the read scope and never widens it: an unknown or
 * out-of-scope id answers `[]`, never a 403 (ADR 0068 ruling 4).
 *
 * Assertions live here; `dashboards-list-location.integration.test.ts` is the
 * Vitest entry point (ADR 0014) and owns fixtures and cleanup.
 */

export interface LocationListFixtures {
  readonly locationAId: string;
  readonly locationBId: string;
  readonly eskomOrganizationId: string;
  readonly otherOrganizationId: string;
  /** `location_id = A`. */
  readonly siteScopedADashboardId: string;
  /** `asset_group_id` = a group of A, `location_id IS NULL`. */
  readonly groupScopedADashboardId: string;
  /** `location_id = B`. */
  readonly siteScopedBDashboardId: string;
  /** `asset_group_id` = a group of B. */
  readonly groupScopedBDashboardId: string;
  /** Organization-wide: no location, no group. */
  readonly organizationWideDashboardId: string;
  /** An ESKOM dashboard whose `asset_group_id` is a PHEWB group hung on location A. */
  readonly misStampedGroupDashboardId: string;
}

async function ids(
  service: DashboardsService,
  actor: JwtPayload,
  organizationId: string | undefined,
  locationId: string,
): Promise<string[]> {
  const result = await service.list(actor, organizationId, undefined, undefined, locationId);
  return result.items.map((item) => item.id);
}

/** A site-scoped AND a group-scoped dashboard of the location are both returned. */
export async function assertLocationFilterReturnsSiteAndGroupScopedRows(
  service: DashboardsService,
  actor: JwtPayload,
  f: LocationListFixtures,
): Promise<void> {
  const got = await ids(service, actor, undefined, f.locationAId);
  expect(got).toContain(f.siteScopedADashboardId);
  expect(got).toContain(f.groupScopedADashboardId);
}

/** Another location's rows (site- and group-scoped) and the org-wide row are excluded. */
export async function assertLocationFilterExcludesOtherLocationsAndOrgWideRows(
  service: DashboardsService,
  actor: JwtPayload,
  f: LocationListFixtures,
): Promise<void> {
  const got = await ids(service, actor, undefined, f.locationAId);
  expect(got).not.toContain(f.siteScopedBDashboardId);
  expect(got).not.toContain(f.groupScopedBDashboardId);
  expect(got).not.toContain(f.organizationWideDashboardId);
  // The adjacent positive control, so an all-empty answer cannot pass the block above.
  expect(got.length).toBeGreaterThanOrEqual(2);
}

/** The unfiltered list still contains every fixture — the filter is opt-in. */
export async function assertUnfilteredListIsUnchanged(
  service: DashboardsService,
  actor: JwtPayload,
  f: LocationListFixtures,
): Promise<void> {
  const got = (await service.list(actor)).items.map((item) => item.id);
  for (const id of [
    f.siteScopedADashboardId,
    f.groupScopedADashboardId,
    f.siteScopedBDashboardId,
    f.groupScopedBDashboardId,
    f.organizationWideDashboardId,
  ]) {
    expect(got).toContain(id);
  }
}

/** ANDed with the organization scope: a location of ESKOM asked for under another organization is []. */
export async function assertLocationFilterIsAndedWithTheOrganizationScope(
  service: DashboardsService,
  actor: JwtPayload,
  f: LocationListFixtures,
): Promise<void> {
  const same = await ids(service, actor, f.eskomOrganizationId, f.locationAId);
  expect(same).toContain(f.siteScopedADashboardId);
  const other = await ids(service, actor, f.otherOrganizationId, f.locationAId);
  expect(other).toEqual([]);
}

/** An unknown location id answers `[]`, not a refusal. */
export async function assertUnknownLocationAnswersEmpty(
  service: DashboardsService,
  actor: JwtPayload,
): Promise<void> {
  const got = await ids(service, actor, undefined, "00000000-0000-4000-8000-00000000f372");
  expect(got).toEqual([]);
}

/**
 * The service's `asset_groups.organization_id = dashboards.organization_id` predicate: on the
 * FLEET branch (`BYPASSRLS`) nothing else stops a group of another organization, hung on this
 * location, from admitting a dashboard that points at it. The group's location IS A and the
 * dashboard is readable to this actor, so only that predicate excludes the row.
 */
export async function assertMisStampedGroupDoesNotAdmitAnotherOrganizationsDashboard(
  service: DashboardsService,
  actor: JwtPayload,
  f: LocationListFixtures,
): Promise<void> {
  const got = await ids(service, actor, undefined, f.locationAId);
  expect(got).not.toContain(f.misStampedGroupDashboardId);
  // The adjacent positive controls: the row is readable unfiltered, and the honest rows show.
  expect((await service.list(actor)).items.map((item) => item.id)).toContain(
    f.misStampedGroupDashboardId,
  );
  expect(got).toContain(f.groupScopedADashboardId);
}
