// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import {
  addingAWidgetSelectsItForEditing,
  anUnselectedWidgetsProblemRendersInTheSummary,
  assetGroupAdminCreatesAGroupDashboardFromItsOwnScope,
  assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList,
  assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups,
  assetGroupAdminsCreateFormDoesNotFetchLocations,
  assetGroupAdminsCreateFormDoesNotFetchOrganizations,
  assetGroupAdminsGroupListComesFromItsOwnScope,
  assetGroupAdminsWidgetInspectorOffersTheAssetChain,
  createIsDisabledUntilRequiredFieldsAreFilled,
  creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId,
  locationAdminDoesNotFetchAssetGroups,
  locationAdminGetsNoAssetGroupOptionOnTheComposedPage,
  locationAdminGetsNoOrganizationWideOptionOnTheComposedPage,
} from "./dashboard-builder-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard builder page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The role cases sign an `asset_group_admin` scope into the store; reset it here, where a
    // failing `expect` cannot skip it.
    useAuthStore.setState({ scope: null });
  });

  it("gives a location_admin no organization-wide option on the composed page", async () => {
    await locationAdminGetsNoOrganizationWideOptionOnTheComposedPage();
  });

  it("gives a location_admin no asset-group option on the composed page (F3.34)", async () => {
    await locationAdminGetsNoAssetGroupOptionOnTheComposedPage();
  });

  it("creating with an asset group sends assetGroupId and no locationId (F3.34)", async () => {
    await creatingWithAnAssetGroupSendsAssetGroupIdAndNoLocationId();
  });

  it("selects a newly added widget for editing", async () => {
    await addingAWidgetSelectsItForEditing();
  });

  it("disables Create dashboard until the required fields are filled", async () => {
    await createIsDisabledUntilRequiredFieldsAreFilled();
  });

  it("renders an unselected widget's problem in a summary beside Save", async () => {
    await anUnselectedWidgetsProblemRendersInTheSummary();
  });

  it("an asset_group_admin's create form does not fetch organizations (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchOrganizations();
  });

  it("an asset_group_admin's create form does not fetch locations (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchLocations();
  });

  it("an asset_group_admin's create form does not fetch the admin asset-group list (F3.63)", async () => {
    await assetGroupAdminsCreateFormDoesNotFetchAdminAssetGroups();
  });

  it("an asset_group_admin's group list comes from its own /auth/me scope (F3.63)", async () => {
    await assetGroupAdminsGroupListComesFromItsOwnScope();
  });

  it("an asset_group_admin creates a group dashboard from its own scope (F3.63)", async () => {
    await assetGroupAdminCreatesAGroupDashboardFromItsOwnScope();
  });

  it("a location_admin does not fetch asset groups (F3.63, the F3.34 residual)", async () => {
    await locationAdminDoesNotFetchAssetGroups();
  });

  it("an asset_group_admin's widget inspector offers the asset chain (F3.63)", async () => {
    await assetGroupAdminsWidgetInspectorOffersTheAssetChain();
  });

  it("an asset_group_admin with no store scope gets an empty group list, not a crash (F3.63)", async () => {
    await assetGroupAdminWithNoStoreScopeGetsAnEmptyGroupList();
  });
});
