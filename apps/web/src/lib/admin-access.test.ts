import { describe, it } from "vitest";

import {
  runAdminAccessTests,
  runAssetGroupScopePredicateTests,
  runAssetTemplateTabTests,
  runDashboardAuthoringPredicateTests,
  runCalcParameterPredicateTests,
  runLocationScopePredicateTests,
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
});
