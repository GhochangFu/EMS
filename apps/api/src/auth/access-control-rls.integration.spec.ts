import { expect } from "vitest";

import type { AccessControlService } from "./access-control.service";
import { jwtFor, SEEDED } from "./access-control.integration.spec";

/**
 * `F4.16` / ADR 0043 — the RLS-enforcement half of `F4.10`'s coverage.
 *
 * `access-control.integration.test.ts` proves query CORRECTNESS by passing the
 * owner connection as all three pools — exactly the setup that cannot tell "RLS
 * enforced" from "RLS bypassed" apart, since the owner sees everything either
 * way. This file constructs `AccessControlService` with the real, non-owner
 * `bms_auth`/`bms_tenant`/`bms_fleet` roles instead, and is what would have
 * caught the regression found while building `F4.16`: before this service ran
 * its grant-resolution reads on the auth pool, a real `bms_tenant` connection
 * with no `SET LOCAL app.current_organization` ever issued returned an empty
 * scope for every non-admin role, because `locations` and
 * `user_organization_access` carry `ENABLE ROW LEVEL SECURITY` (decision 10)
 * and the tenant pool holds no grant that reaches them unscoped.
 */

export async function assertLocationAdminScopeSurvivesRealRls(
  svc: AccessControlService,
): Promise<void> {
  const jwt = jwtFor(SEEDED.locationAdmin, "location_admin");
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("location");
  expect(scope.locations.length).toBeGreaterThan(0);
  expect(scope.assetIds.length).toBeGreaterThan(0);

  const writable = await svc.writableLocationIds(jwt);
  expect(writable).not.toBeNull();
  expect((writable as string[]).length).toBeGreaterThan(0);
}

export async function assertOrganizationAdminScopeSurvivesRealRls(
  svc: AccessControlService,
): Promise<void> {
  const jwt = jwtFor(SEEDED.organizationAdmin, "organization_admin");
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("location");
  expect(scope.locations.length).toBeGreaterThan(0);

  const writableOrgs = await svc.writableOrganizationIds(jwt);
  expect(writableOrgs).not.toBeNull();
  expect((writableOrgs as string[]).length).toBeGreaterThan(0);
}

export async function assertAssetGroupAdminScopeSurvivesRealRls(
  svc: AccessControlService,
): Promise<void> {
  const jwt = jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin");
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("asset_group");
  expect(scope.assetGroups.length).toBeGreaterThan(0);
  expect(scope.assetIds.length).toBeGreaterThan(0);
}

/** The fleet pool's BYPASSRLS must still see every organization at once. */
export async function assertGlobalAdminScopeSurvivesRealRls(
  svc: AccessControlService,
  expectedActiveLocationCount: number,
): Promise<void> {
  const jwt = jwtFor(SEEDED.globalAdmin, "admin");
  const { scope } = await svc.currentUser(jwt);
  expect(scope.kind).toBe("global");
  expect(scope.locations.length).toBe(expectedActiveLocationCount);
  expect((await svc.readableAssetIds(jwt))).toBeNull();
}

/**
 * The negative half: a real tenant connection must still isolate organizations
 * from each other, not merely "not be empty". An empty-scope bug and a
 * cross-organization leak are different failures, and only this proves neither
 * happened — a scope that leaked org B into org A's admin is also non-empty.
 */
export async function assertOrganizationAdminStillIsolatedUnderRealRls(
  svc: AccessControlService,
): Promise<void> {
  const jwt = jwtFor(SEEDED.organizationAdmin, "organization_admin");
  const { scope } = await svc.currentUser(jwt);
  const globalJwt = jwtFor(SEEDED.globalAdmin, "admin");
  const { scope: globalScope } = await svc.currentUser(globalJwt);

  expect(globalScope.locations.length).toBeGreaterThan(scope.locations.length);

  const otherLocationIds = globalScope.locations
    .map((location) => location.id)
    .filter((id) => !scope.locations.some((granted) => granted.id === id));
  expect(otherLocationIds.length).toBeGreaterThan(0);

  const foreignLocationId = otherLocationIds[0] as string;
  expect(await svc.canManageLocation(jwt, foreignLocationId)).toBe(false);
}
