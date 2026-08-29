// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  adminSeesTheOrganizationWideOption,
  assetGroupAdminNeverSeesTheOrganizationWideOptionEither,
  locationAdminNeverSeesTheOrganizationWideOption,
  noRoleIsOfferedAnAssetGroupOption,
  organizationAdminSeesTheOrganizationWideOption,
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

  it("offers no role an asset-group option", () => {
    noRoleIsOfferedAnAssetGroupOption();
  });
});
