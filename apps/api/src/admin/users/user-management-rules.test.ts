import { describe, it } from "vitest";

import {
  assertADemotionFromAdminWithoutAnOrganizationIsAnError,
  assertAdminManagesAnAdminTarget,
  assertAGrantOutsideTheCallersOrganizationsRefuses,
  assertANullHomeOrganizationCountsAsOutside,
  assertAnOrganizationAdminWithNoOrganizationsManagesNobody,
  assertAnOrganizationWithoutABoundaryCrossingIsAnError,
  assertAnUnrestrictedListForANonAdminFailsClosed,
  assertAPromotionToAdminWithoutANullOrganizationIsAnError,
  assertAValidDemotionIsNoError,
  assertOnlyTheTwoManagerRolesManage,
  assertOrganizationAdminCannotGiveAdmin,
  assertOrganizationAdminManagesATargetWhollyInside,
  assertOrganizationAdminNeverManagesAnAdminTarget,
  assertTouchesAdminOnEitherSide,
} from "./user-management-rules.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.78 — user management rules (ADR 0089 decision 2)", () => {
  it("admin manages an admin target", () => {
    assertAdminManagesAnAdminTarget();
  });

  it("organization_admin never manages an admin target", () => {
    assertOrganizationAdminNeverManagesAnAdminTarget();
  });

  it("organization_admin manages a target whose whole reach is inside its organizations", () => {
    assertOrganizationAdminManagesATargetWhollyInside();
  });

  it("a grant organization outside the caller's organizations refuses", () => {
    assertAGrantOutsideTheCallersOrganizationsRefuses();
  });

  it("a NULL home organization counts as outside, not as an empty set", () => {
    assertANullHomeOrganizationCountsAsOutside();
  });

  it("an organization_admin with no organizations manages nobody", () => {
    assertAnOrganizationAdminWithNoOrganizationsManagesNobody();
  });

  it("an unrestricted (null) organization list for a non-admin fails closed", () => {
    assertAnUnrestrictedListForANonAdminFailsClosed();
  });

  it("only admin and organization_admin are manager roles", () => {
    assertOnlyTheTwoManagerRolesManage();
  });

  it("organization_admin cannot give the admin role", () => {
    assertOrganizationAdminCannotGiveAdmin();
  });

  it("a change touches admin when the old or the new role is admin", () => {
    assertTouchesAdminOnEitherSide();
  });

  it("organizationId without an admin boundary crossing is an error", () => {
    assertAnOrganizationWithoutABoundaryCrossingIsAnError();
  });

  it("a demotion from admin without an organization is an error", () => {
    assertADemotionFromAdminWithoutAnOrganizationIsAnError();
  });

  it("a promotion to admin without organizationId null is an error", () => {
    assertAPromotionToAdminWithoutANullOrganizationIsAnError();
  });

  it("a demotion from admin that names an organization is valid", () => {
    assertAValidDemotionIsNoError();
  });
});
