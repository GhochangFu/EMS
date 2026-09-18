// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import {
  anAssetScopedSourcePrefillsAsOrganizationWide,
  assetGroupAdminOnAForeignGroupCannotDuplicate,
  assetGroupAdminOnItsOwnGroupHasDuplicateEnabled,
  locationAdminOnAForeignLocationCannotDuplicate,
  assetGroupAdminDuplicatesItsGroupDashboardAndKeepsTheGroup,
  assetGroupAdminsDialogDoesNotFetchAdminAssetGroups,
  assetGroupAdminsDialogDoesNotFetchLocations,
  assetGroupAdminsDialogListsItsOwnGroups,
  duplicatesAndNavigatesIntoTheNewDashboardsBuilder,
  duplicatingAnAssetGroupDashboardKeepsTheGroup,
  locationAdminGetsNoAssetGroupOption,
  locationAdminGetsNoOrganizationWideOption,
  prefillsNameAndSlugSkippingATakenCandidate,
  showsTheBindingsCarryOverWarning,
  theGroupListIsTheSourcesOrganizationOnly,
  widgetCopyFailureRendersInlineWithoutDeletingTheHalfMadeCopy,
} from "./duplicate-dashboard-dialog.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects (ADR
 * 0042 decision 2).
 */
describe("F3.1d Unit 9 — DuplicateDashboardDialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // The role cases sign an `asset_group_admin` scope into the store; reset it here, where a
    // failing `expect` cannot skip it.
    useAuthStore.setState({ scope: null });
  });

  it("states in visible text that a copy carries the source's bindings", async () => {
    await showsTheBindingsCarryOverWarning();
  });

  it("gives a location_admin no organization-wide option", async () => {
    await locationAdminGetsNoOrganizationWideOption();
  });

  it("gives a location_admin no asset-group option (F3.34)", async () => {
    await locationAdminGetsNoAssetGroupOption();
  });

  it("an asset_group_admin on its own group has Duplicate enabled (F3.63 sweep, positive control)", async () => {
    await assetGroupAdminOnItsOwnGroupHasDuplicateEnabled();
  });

  it("an asset_group_admin on a group it does not hold cannot duplicate (F3.63 sweep)", async () => {
    await assetGroupAdminOnAForeignGroupCannotDuplicate();
  });

  it("a location_admin on a location it does not hold cannot duplicate (F3.63 sweep)", async () => {
    await locationAdminOnAForeignLocationCannotDuplicate();
  });

  it("duplicating an asset-group dashboard keeps the group (F3.34)", async () => {
    await duplicatingAnAssetGroupDashboardKeepsTheGroup();
  });

  it("the group list is the source's organization only (F3.34)", async () => {
    await theGroupListIsTheSourcesOrganizationOnly();
  });

  it("prefills name and slug from the source, skipping an already-taken candidate", async () => {
    await prefillsNameAndSlugSkippingATakenCandidate();
  });

  it("creates, replaces widgets with every source id dropped, and navigates into the new builder", async () => {
    await duplicatesAndNavigatesIntoTheNewDashboardsBuilder();
  });

  it("on a widget-copy failure renders the error inline and never deletes the half-made copy", async () => {
    await widgetCopyFailureRendersInlineWithoutDeletingTheHalfMadeCopy();
  });

  it("an asset_group_admin's dialog does not fetch locations (F3.63)", async () => {
    await assetGroupAdminsDialogDoesNotFetchLocations();
  });

  it("an asset_group_admin's dialog does not fetch the admin asset-group list (F3.63)", async () => {
    await assetGroupAdminsDialogDoesNotFetchAdminAssetGroups();
  });

  it("an asset_group_admin's dialog lists its own groups from /auth/me (F3.63)", async () => {
    await assetGroupAdminsDialogListsItsOwnGroups();
  });

  it("an asset_group_admin duplicates its group dashboard and keeps the group (F3.63)", async () => {
    await assetGroupAdminDuplicatesItsGroupDashboardAndKeepsTheGroup();
  });

  it("an asset-scoped source prefills as organization-wide (F3.63, Amendment 6 Q2)", async () => {
    await anAssetScopedSourcePrefillsAsOrganizationWide();
  });
});
