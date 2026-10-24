import { describe, it } from "vitest";

import {
  aManageableAssetResolvesTheImageUpload,
  anAssetGroupAdminIsRefusedTheImageUpload,
  anAssetGroupAdminIsRefusedTheImport,
  anAssetGroupAdminIsRefusedTheReadings,
  anUnboundConversationIsRefusedTheImport,
  anUnmanageableAssetIsRefusedTheImageUpload,
  theMasterDataRolesResolveTheImportToTheBoundOrganization,
  theReadingsResolveToTheBoundOrganizationsName,
} from "./copilot-target-resolver.telemetry.spec";

/** `F4.283` — Vitest entry point for the telemetry and image targets. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.283 — the telemetry and asset image targets (ADR 0099 Amendment 8 D2)", () => {
  it("admin, organization_admin and location_admin resolve the import to the bound organization", () =>
    theMasterDataRolesResolveTheImportToTheBoundOrganization());
  it("the readings resolve to the bound organization's name", () => theReadingsResolveToTheBoundOrganizationsName());
  it("an asset_group_admin is refused the import", () => anAssetGroupAdminIsRefusedTheImport());
  it("an asset_group_admin is refused the readings", () => anAssetGroupAdminIsRefusedTheReadings());
  it("an unbound conversation is refused the import", () => anUnboundConversationIsRefusedTheImport());
  it("a manageable asset resolves the image upload", () => aManageableAssetResolvesTheImageUpload());
  it("canManageAsset false refuses the image upload", () => anUnmanageableAssetIsRefusedTheImageUpload());
  it("an asset_group_admin is refused the image upload", () => anAssetGroupAdminIsRefusedTheImageUpload());
});
