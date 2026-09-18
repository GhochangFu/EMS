// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import {
  aLocationDashboardDoesNotFetchAssets,
  anAssetScopedDashboardNamesItsAsset,
  anAssetScopedDashboardReadsTheOrganizationsAssets,
  anAssetScopedDashboardRendersNoRadios,
  anAssetScopedDashboardWithTheAssetAbsentShowsTheId,
  anUneditedAssetScopedDashboardIsNotDirty,
  anUneditedGroupScopedDashboardIsNotDirty,
  assetGroupAdminOnAForeignGroupCannotSave,
  assetGroupAdminRenamesItsGroupDashboardAndKeepsTheGroup,
  assetGroupAdminsEditPageDoesNotFetchAdminAssetGroups,
  assetGroupAdminsEditPageDoesNotFetchLocations,
  assetGroupAdminsEditPageListsItsOwnGroups,
  assetGroupAdminsWidgetInspectorOffersTheAssetChain,
  choosingADifferentGroupMakesItDirty,
  choosingADifferentLocationMakesItDirty,
  locationAdminOnAForeignLocationCannotSave,
  movingALocationDashboardOntoAGroupSendsTheGroupAndClearsTheLocation,
  renamingAGroupScopedDashboardKeepsItsGroup,
  renamingAnAssetScopedDashboardSendsOnlyNameAndDescription,
  theGroupListIsTheDashboardsOrganizationOnly,
  thePatchBodyForAnAssetScopedDashboardHasExactlyTwoKeys,
} from "./dashboard-builder-edit-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard builder edit page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The role cases sign an `asset_group_admin` scope into the store; reset it here, where a
    // failing `expect` cannot skip it.
    useAuthStore.setState({ scope: null });
  });

  it("renaming a group-scoped dashboard keeps its group (F3.34)", async () => {
    await renamingAGroupScopedDashboardKeepsItsGroup();
  });

  it("moving a location dashboard onto a group sends the group and clears the location (F3.34)", async () => {
    await movingALocationDashboardOntoAGroupSendsTheGroupAndClearsTheLocation();
  });

  it("an unedited group-scoped dashboard is not dirty (F3.34)", async () => {
    await anUneditedGroupScopedDashboardIsNotDirty();
  });

  it("choosing a different group makes it dirty (F3.34)", async () => {
    await choosingADifferentGroupMakesItDirty();
  });

  it("choosing a different location makes it dirty (F3.34 sweep)", async () => {
    await choosingADifferentLocationMakesItDirty();
  });

  it("the group list is the dashboard's organization only (F3.34)", async () => {
    await theGroupListIsTheDashboardsOrganizationOnly();
  });

  it("renaming an asset-scoped dashboard sends only name and description (F3.63, Amendment 6 Q2)", async () => {
    await renamingAnAssetScopedDashboardSendsOnlyNameAndDescription();
  });

  it("the PATCH body for an asset-scoped dashboard has exactly the two keys (F3.63)", async () => {
    await thePatchBodyForAnAssetScopedDashboardHasExactlyTwoKeys();
  });

  it("an asset-scoped dashboard names its asset (F3.63)", async () => {
    await anAssetScopedDashboardNamesItsAsset();
  });

  it("an asset-scoped dashboard renders no radios (F3.63)", async () => {
    await anAssetScopedDashboardRendersNoRadios();
  });

  it("an asset-scoped dashboard reads its organization's assets (F3.63)", async () => {
    await anAssetScopedDashboardReadsTheOrganizationsAssets();
  });

  it("an asset-scoped dashboard with the asset absent from /assets shows the id (F3.63)", async () => {
    await anAssetScopedDashboardWithTheAssetAbsentShowsTheId();
  });

  it("a location dashboard does not fetch assets (F3.63)", async () => {
    await aLocationDashboardDoesNotFetchAssets();
  });

  it("an unedited asset-scoped dashboard is not dirty (F3.63)", async () => {
    await anUneditedAssetScopedDashboardIsNotDirty();
  });

  it("an asset_group_admin's edit page does not fetch locations (F3.63)", async () => {
    await assetGroupAdminsEditPageDoesNotFetchLocations();
  });

  it("an asset_group_admin's edit page does not fetch the admin asset-group list (F3.63)", async () => {
    await assetGroupAdminsEditPageDoesNotFetchAdminAssetGroups();
  });

  it("an asset_group_admin's edit page lists its own groups from /auth/me (F3.63)", async () => {
    await assetGroupAdminsEditPageListsItsOwnGroups();
  });

  it("an asset_group_admin renames its group dashboard and keeps the group (F3.63)", async () => {
    await assetGroupAdminRenamesItsGroupDashboardAndKeepsTheGroup();
  });

  it("an asset_group_admin's widget inspector offers the asset chain (F3.63)", async () => {
    await assetGroupAdminsWidgetInspectorOffersTheAssetChain();
  });

  it("an asset_group_admin on a group it does not hold cannot save a rename (F3.63 review)", async () => {
    await assetGroupAdminOnAForeignGroupCannotSave();
  });

  it("a location_admin on a location it does not hold cannot save a rename (F3.63 review)", async () => {
    await locationAdminOnAForeignLocationCannotSave();
  });
});
