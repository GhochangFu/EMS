// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  anUneditedGroupScopedDashboardIsNotDirty,
  choosingADifferentGroupMakesItDirty,
  choosingADifferentLocationMakesItDirty,
  movingALocationDashboardOntoAGroupSendsTheGroupAndClearsTheLocation,
  renamingAGroupScopedDashboardKeepsItsGroup,
  theGroupListIsTheDashboardsOrganizationOnly,
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
});
