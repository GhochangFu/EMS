// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anEmptyOrganizationRendersThePromptForAdmin,
  anEmptyOrganizationRendersThePromptForAnAssetGroupAdmin,
  choosingAPointCallsOnAddWithTheDto,
  choosingAnAssetListsItsPointsUnderAddPoint,
  choosingAnAssetReadsItsPointsFromTheNonAdminRoute,
  forAdminChoosingALocationReadsTheAdminPoints,
  forAdminNoAssetFetchFires,
  forAdminTheFirstSelectIsLocation,
  forAdminTheLocationsAreFilteredToTheOrganization,
  forAdminThereIsNoAssetSelect,
  forAnAssetGroupAdminNoMasterDataLocationFetchFires,
  forAnAssetGroupAdminNoMasterDataPointFetchFires,
  forAnAssetGroupAdminTheAssetsAreFilteredToTheOrganization,
  forAnAssetGroupAdminTheFirstSelectIsAsset,
} from "./point-picker.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.63 point picker — the asset→points chain for asset_group_admin", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers an asset_group_admin the Asset select first", async () => {
    await forAnAssetGroupAdminTheFirstSelectIsAsset();
  });

  it("filters the assets to the dashboard's organization", async () => {
    await forAnAssetGroupAdminTheAssetsAreFilteredToTheOrganization();
  });

  it("never fetches the admin locations for an asset_group_admin", async () => {
    await forAnAssetGroupAdminNoMasterDataLocationFetchFires();
  });

  it("never fetches the admin points for an asset_group_admin", async () => {
    await forAnAssetGroupAdminNoMasterDataPointFetchFires();
  });

  it("reads a chosen asset's points from the non-admin route", async () => {
    await choosingAnAssetReadsItsPointsFromTheNonAdminRoute();
  });

  it("lists the chosen asset's points under Add point", async () => {
    await choosingAnAssetListsItsPointsUnderAddPoint();
  });

  it("calls onAdd with the chosen point's DTO", async () => {
    await choosingAPointCallsOnAddWithTheDto();
  });
});

describe("F3.63 point picker — the location→points chain is unchanged for admin", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers admin the Location select first", async () => {
    await forAdminTheFirstSelectIsLocation();
  });

  it("filters the locations to the dashboard's organization", async () => {
    await forAdminTheLocationsAreFilteredToTheOrganization();
  });

  it("renders no Asset select for admin", async () => {
    await forAdminThereIsNoAssetSelect();
  });

  it("never fetches the non-admin assets for admin", async () => {
    await forAdminNoAssetFetchFires();
  });

  it("reads a chosen location's points from the admin route", async () => {
    await forAdminChoosingALocationReadsTheAdminPoints();
  });
});

describe("F3.63 point picker — no organization yet", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the scope prompt for an asset_group_admin", () => {
    anEmptyOrganizationRendersThePromptForAnAssetGroupAdmin();
  });

  it("renders the scope prompt for admin", () => {
    anEmptyOrganizationRendersThePromptForAdmin();
  });
});
