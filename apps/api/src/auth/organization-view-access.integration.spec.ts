import { expect } from "vitest";

import {
  clearOrganizationView,
  newOrganizationWideDashboard,
  pointOrganizationAt,
  type OrganizationLayoutFixture,
} from "../testing/organization-layout-harness";
import { OrganizationViewAccessService } from "./organization-view-access.service";

/**
 * `F4.317` task 4.1 (ADR 0112 decision 5) — who may change an organization's Control Room strip,
 * and which dashboard is the one its view row points at. Assertions only; the wrapper
 * `organization-view-access.integration.test.ts` owns the harness (ADR 0014).
 */

function serviceOf(fx: OrganizationLayoutFixture): OrganizationViewAccessService {
  return new OrganizationViewAccessService(fx.fleetDb, fx.accessControl);
}

/** Four roles, each on its own organization (A) and on a foreign one (B). */
export async function assertTheFourRolesOnOwnAndForeign(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  const cases = [
    { who: "admin", jwt: fx.jwt.admin, own: true, foreign: true },
    { who: "organization_admin of A", jwt: fx.jwt.orgAdminA, own: true, foreign: false },
    { who: "location_admin of A", jwt: fx.jwt.locAdminA, own: true, foreign: false },
    { who: "asset_group_admin of A", jwt: fx.jwt.groupAdminA, own: false, foreign: false },
  ];
  const seen = await Promise.all(
    cases.map(async (c) => ({
      who: c.who,
      own: await svc.canManageOrganizationView(c.jwt, fx.orgA),
      foreign: await svc.canManageOrganizationView(c.jwt, fx.orgB),
    })),
  );
  expect(seen).toEqual(cases.map(({ who, own, foreign }) => ({ who, own, foreign })));
}

/** A location admin of B manages B's strip and not A's: the grant follows the location's organization. */
export async function assertTheLocationGrantFollowsItsOrganization(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  expect(await svc.canManageOrganizationView(fx.jwt.locAdminB, fx.orgB)).toBe(true);
  expect(await svc.canManageOrganizationView(fx.jwt.locAdminB, fx.orgA)).toBe(false);
}

/**
 * The pointed dashboard is that row's dashboard in that organization, and no other: another
 * organization-wide dashboard of A is not it, A's pointed id asked under B is not it, and a row
 * whose dashboard was removed (NULL) points at nothing.
 */
export async function assertOnlyThePointedDashboardIsPointed(fx: OrganizationLayoutFixture): Promise<void> {
  const svc = serviceOf(fx);
  const pointed = await newOrganizationWideDashboard(fx, fx.orgA, "pointed");
  const other = await newOrganizationWideDashboard(fx, fx.orgA, "other");
  try {
    await pointOrganizationAt(fx, fx.orgA, pointed);
    expect(await svc.isPointedOrganizationDashboard(fx.orgA, pointed)).toBe(true);
    expect(await svc.isPointedOrganizationDashboard(fx.orgA, other)).toBe(false);
    expect(await svc.isPointedOrganizationDashboard(fx.orgB, pointed)).toBe(false);

    await pointOrganizationAt(fx, fx.orgA, null);
    expect(await svc.isPointedOrganizationDashboard(fx.orgA, pointed)).toBe(false);
  } finally {
    await clearOrganizationView(fx, fx.orgA);
  }
}
