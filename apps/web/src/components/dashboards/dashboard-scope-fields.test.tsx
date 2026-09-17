// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminSeesTheAssetGroupOption,
  adminSeesTheOrganizationWideOption,
  assetGroupAdminNeverSeesTheAssetGroupOption,
  assetGroupAdminNeverSeesTheOrganizationWideOptionEither,
  choosingAGroupDecidesTheOrganization,
  forALocationAdminAnAssetGroupValueClampsToLocation,
  forALocationAdminAnOrganizationWideValueClampsToLocation,
  forAdminAnAssetGroupValueIsNotClamped,
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

  it("never shows an asset_group_admin the asset-group option", () => {
    assetGroupAdminNeverSeesTheAssetGroupOption();
  });

  it("decides the organization from the chosen group", async () => {
    await choosingAGroupDecidesTheOrganization();
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
