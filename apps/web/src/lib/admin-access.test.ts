import { describe, it } from "vitest";

import {
  runAdminAccessTests,
  runAssetGroupScopePredicateTests,
  runAssetTemplateTabTests,
  runCanManageLocationTypesTests,
  runCanManageMimicLayoutsAdminsTest,
  runCanManageMimicLayoutsOthersTest,
  runMimicLayoutsTabHiddenFromLocationAdminTest,
  runMimicLayoutsTabShownToOrganizationAdminTest,
  runDashboardAuthoringPredicateTests,
  runCalcParameterPredicateTests,
  runLocationScopePredicateTests,
  runLocationTypesTabHiddenFromOrganizationAdminTest,
  runLocationTypesTabShownToAdminTest,
  runNotificationTabTests,
} from "./admin-access.spec";

/** Vitest entry point — see `apps/api/src/admin/admin.schema.test.ts` (ADR 0014). */
describe("admin-access", () => {
  it("gates admin routes by role", () => {
    runAdminAccessTests();
  });

  it("shows the Asset Templates tab to every master-data role", () => {
    runAssetTemplateTabTests();
  });

  it("shows the F3.8 notification tabs to admin and organization_admin only", () => {
    runNotificationTabTests();
  });

  it("gates dashboard authoring and the organization-wide scope by role", () => {
    runDashboardAuthoringPredicateTests();
  });

  it("offers the asset-group dashboard scope to admin, organization_admin and asset_group_admin", () => {
    runAssetGroupScopePredicateTests();
  });

  it("offers the location dashboard scope to the three master-data roles only", () => {
    runLocationScopePredicateTests();
  });

  it("gates calc parameter writes by role, and the organization scope by the two global roles (E4.1a)", () => {
    runCalcParameterPredicateTests();
  });

  it("A1 canManageLocationTypes is the global admin alone (F4.162)", () => {
    runCanManageLocationTypesTests();
  });

  it("A2a shows the Location Types tab to admin (F4.162)", () => {
    runLocationTypesTabShownToAdminTest();
  });

  it("A2b hides the Location Types tab from organization_admin (F4.162)", () => {
    runLocationTypesTabHiddenFromOrganizationAdminTest();
  });

  it("canManageMimicLayouts admits admin and organization_admin (F3.32c)", () => {
    runCanManageMimicLayoutsAdminsTest();
  });

  it("canManageMimicLayouts refuses every other role (F3.32c)", () => {
    runCanManageMimicLayoutsOthersTest();
  });

  it("shows the Mimic Layouts tab to organization_admin (F3.32c)", () => {
    runMimicLayoutsTabShownToOrganizationAdminTest();
  });

  it("hides the Mimic Layouts tab from location_admin (F3.32c)", () => {
    runMimicLayoutsTabHiddenFromLocationAdminTest();
  });
});
