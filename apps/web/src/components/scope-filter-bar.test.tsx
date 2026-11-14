// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aChoiceReportsItsKey,
  aLockedOrganizationIsPreselectedAndDisabled,
  assetGroupsAcrossLocationsNameTheirLocation,
  locationWaitsForAnOrganization,
  theLocationsReadAsATree,
  unavailableDisablesEveryPicker,
} from "./scope-filter-bar.spec";

/** `F4.361` U6 — the scope filter bar. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 ScopeFilterBar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("preselects and disables a single organization", () => aLockedOrganizationIsPreselectedAndDisabled());
  it("disables Location, Asset group and Asset without an organization", () => locationWaitsForAnOrganization());
  it("lists the locations as a tree and narrows the rest", () => theLocationsReadAsATree());
  it("reports the key and value of a choice", () => aChoiceReportsItsKey());
  it("disables every picker when the options are unavailable", () => unavailableDisablesEveryPicker());
  it("F4.363: names the location of each asset group when they span locations", () =>
    assetGroupsAcrossLocationsNameTheirLocation());
});
