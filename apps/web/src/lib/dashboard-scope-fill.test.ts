import { describe, it } from "vitest";

import {
  aChangedGroupMakesAGroup,
  aChangedLocationWinsOverAnUnchangedGroup,
  aLocationFillOverAnUnchosenGroupMakesALocation,
  anUnchangedFillKeepsTheKind,
  twoNullsMakeTheOrganizationWideScope,
} from "./dashboard-scope-fill.spec";

describe("chosenScopeFromFill (F3.85 PR 9 review C3)", () => {
  it("a changed location wins over an unchanged group", () => {
    aChangedLocationWinsOverAnUnchangedGroup();
  });

  it("a location fill over an unchosen group makes a location", () => {
    aLocationFillOverAnUnchosenGroupMakesALocation();
  });

  it("a changed group makes a group", () => {
    aChangedGroupMakesAGroup();
  });

  it("two nulls make the organization-wide scope", () => {
    twoNullsMakeTheOrganizationWideScope();
  });

  it("a fill that changes neither column keeps the kind and takes the organization", () => {
    anUnchangedFillKeepsTheKind();
  });
});
