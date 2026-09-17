// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminSeesTheAssetGroupOption,
  adminSeesTheOrganizationWideOption,
  adminStillSeesTheLocationOption,
  anAssetValueNamesTheAsset,
  anAssetValueRendersNoRadios,
  anAssetValueWithNoMatchingAssetFallsBackToTheId,
  assetGroupAdminNeverSeesTheLocationOption,
  assetGroupAdminNeverSeesTheLocationSelectEither,
  assetGroupAdminSeesTheAssetGroupOption,
  assetGroupAdminNeverSeesTheOrganizationWideOptionEither,
  choosingAGroupDecidesTheOrganization,
  clickingTheAssetGroupRadioAloneDecidesTheOrganization,
  forALocationAdminAnAssetGroupValueClampsToLocation,
  forALocationAdminAnOrganizationWideValueClampsToLocation,
  forAdminAnAssetGroupValueIsNotClamped,
  forAdminAnAssetValueIsNotClamped,
  forAnAssetGroupAdminALocationValueClampsToAssetGroup,
  forAnAssetGroupAdminAnAssetValueIsNotClamped,
  locationAdminNeverSeesTheAssetGroupOption,
  locationAdminNeverSeesTheOrganizationWideOption,
  organizationAdminSeesTheAssetGroupOption,
  organizationAdminSeesTheOrganizationWideOption,
  theOptionTextNamesTheLocation,
} from "./dashboard-scope-fields.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard scope fields", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("never shows a location_admin the organization-wide option", () => {
    locationAdminNeverSeesTheOrganizationWideOption();
  });

  it("never shows an asset_group_admin the organization-wide option either", () => {
    assetGroupAdminNeverSeesTheOrganizationWideOptionEither();
  });

  it("shows an organization_admin the organization-wide option", () => {
    organizationAdminSeesTheOrganizationWideOption();
  });

  it("shows admin the organization-wide option", () => {
    adminSeesTheOrganizationWideOption();
  });

  it("clamps a location_admin fed an organization-wide value back to an unchosen location", () => {
    forALocationAdminAnOrganizationWideValueClampsToLocation();
  });
});

describe("F3.34 asset-group scope kind", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows admin the asset-group option", () => {
    adminSeesTheAssetGroupOption();
  });

  it("shows an organization_admin the asset-group option", () => {
    organizationAdminSeesTheAssetGroupOption();
  });

  it("never shows a location_admin the asset-group option", () => {
    locationAdminNeverSeesTheAssetGroupOption();
  });

  it("decides the organization from the chosen group", async () => {
    await choosingAGroupDecidesTheOrganization();
  });

  it("clicking the Asset group radio alone pre-selects the first group and its organization", async () => {
    await clickingTheAssetGroupRadioAloneDecidesTheOrganization();
  });

  it("names the location in the option text", () => {
    theOptionTextNamesTheLocation();
  });

  it("clamps a location_admin fed an assetGroup value back to an unchosen location", () => {
    forALocationAdminAnAssetGroupValueClampsToLocation();
  });

  it("does not clamp an assetGroup value for admin", () => {
    forAdminAnAssetGroupValueIsNotClamped();
  });
});

describe("F3.63 asset_group_admin authoring path and the read-only asset kind", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an asset_group_admin the asset-group option", () => {
    assetGroupAdminSeesTheAssetGroupOption();
  });

  it("never shows an asset_group_admin the location option", () => {
    assetGroupAdminNeverSeesTheLocationOption();
  });

  it("never shows an asset_group_admin the location select either", () => {
    assetGroupAdminNeverSeesTheLocationSelectEither();
  });

  it("still shows admin the location option", () => {
    adminStillSeesTheLocationOption();
  });

  it("clamps an asset_group_admin fed a location value to an unchosen asset group", () => {
    forAnAssetGroupAdminALocationValueClampsToAssetGroup();
  });

  it("renders no radios for an asset value", () => {
    anAssetValueRendersNoRadios();
  });

  it("names the asset on the read-only line", () => {
    anAssetValueNamesTheAsset();
  });

  it("falls back to the id when no asset matches", () => {
    anAssetValueWithNoMatchingAssetFallsBackToTheId();
  });

  it("never clamps an asset value for an asset_group_admin", () => {
    forAnAssetGroupAdminAnAssetValueIsNotClamped();
  });

  it("never clamps an asset value for admin", () => {
    forAdminAnAssetValueIsNotClamped();
  });
});
