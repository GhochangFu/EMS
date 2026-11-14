import { describe, it } from "vitest";

import * as spec from "./filter-options.rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 U3 — buildFilterOptions (ADR 0132 decision 2, plan D9)", () => {
  it("drops an unlisted organization's locations", () => spec.assertAnUnlistedOrganizationsLocationsDrop());
  it("masks an unlisted parentId to null, after the last filter", () => spec.assertAnUnlistedParentIsMaskedToNull());
  it("lists a group's members that the answer lists, and drops a group at a dropped location", () =>
    spec.assertGroupMembersAreListedAssetsOnly());
  it("drops an asset at a dropped location", () => spec.assertAnAssetAtADroppedLocationDrops());
  it("answers four empty lists for nothing readable", () => spec.assertNothingReadableIsFourEmptyLists());
});
