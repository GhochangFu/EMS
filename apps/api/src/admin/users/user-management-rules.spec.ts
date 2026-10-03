import { expect } from "vitest";

import {
  canManageTarget,
  isManagerRole,
  mayAssignRole,
  roleChangeError,
  touchesAdmin,
} from "./user-management-rules";

/**
 * `F3.78` / ADR 0089 decision 2 — the pure "who may manage whom" rules.
 * Assertions live here; `user-management-rules.test.ts` is the entry point.
 */

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const ORG_B = "00000000-0000-4000-8000-00000000000b";

const viewerIn = (home: string | null, grants: string[] = []) => ({
  role: "viewer" as const,
  homeOrganizationId: home,
  grantOrganizationIds: grants,
});

export function assertAdminManagesAnAdminTarget(): void {
  expect(
    canManageTarget("admin", null, { role: "admin", homeOrganizationId: null, grantOrganizationIds: [] }),
  ).toBe(true);
}

export function assertOrganizationAdminNeverManagesAnAdminTarget(): void {
  expect(
    canManageTarget("organization_admin", [ORG_A], {
      role: "admin",
      homeOrganizationId: null,
      grantOrganizationIds: [],
    }),
  ).toBe(false);
}

export function assertOrganizationAdminManagesATargetWhollyInside(): void {
  expect(canManageTarget("organization_admin", [ORG_A, ORG_B], viewerIn(ORG_A, [ORG_B]))).toBe(true);
}

export function assertAGrantOutsideTheCallersOrganizationsRefuses(): void {
  expect(canManageTarget("organization_admin", [ORG_A], viewerIn(ORG_A, [ORG_B]))).toBe(false);
}

export function assertANullHomeOrganizationCountsAsOutside(): void {
  expect(canManageTarget("organization_admin", [ORG_A], viewerIn(null, [ORG_A]))).toBe(false);
}

export function assertAnOrganizationAdminWithNoOrganizationsManagesNobody(): void {
  expect(canManageTarget("organization_admin", [], viewerIn(ORG_A))).toBe(false);
}

export function assertAnUnrestrictedListForANonAdminFailsClosed(): void {
  expect(canManageTarget("organization_admin", null, viewerIn(ORG_A))).toBe(false);
}

export function assertOnlyTheTwoManagerRolesManage(): void {
  expect(["admin", "organization_admin", "location_admin", "viewer"].map(isManagerRole)).toEqual([
    true,
    true,
    false,
    false,
  ]);
}

export function assertOrganizationAdminCannotGiveAdmin(): void {
  expect([mayAssignRole("organization_admin", "admin"), mayAssignRole("organization_admin", "operator")]).toEqual([
    false,
    true,
  ]);
}

export function assertTouchesAdminOnEitherSide(): void {
  expect([touchesAdmin("admin", "viewer"), touchesAdmin("viewer", "admin"), touchesAdmin("viewer", "operator")]).toEqual(
    [true, true, false],
  );
}

export function assertAnOrganizationWithoutABoundaryCrossingIsAnError(): void {
  expect(roleChangeError("viewer", { role: "operator", organizationId: ORG_A })).toMatch(/crosses the admin boundary/);
}

export function assertADemotionFromAdminWithoutAnOrganizationIsAnError(): void {
  expect(roleChangeError("admin", { role: "viewer" })).toMatch(/must name an organization/);
}

export function assertAPromotionToAdminWithoutANullOrganizationIsAnError(): void {
  expect(roleChangeError("viewer", { role: "admin" })).toMatch(/organizationId null/);
}

export function assertAValidDemotionIsNoError(): void {
  expect(roleChangeError("admin", { role: "viewer", organizationId: ORG_A })).toBeNull();
}
