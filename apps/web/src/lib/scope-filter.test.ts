import { describe, it } from "vitest";

import {
  aChildFillsItsOrganization,
  aCrossOrganizationLocationIsDropped,
  aGroupChangeNarrowsTheAsset,
  aGroupOutsideTheSubtreeIsDropped,
  aLocationChangeClearsWhatItNoLongerContains,
  aLockedOrganizationIsNotWritten,
  anAssetOutsideTheGroupIsDropped,
  anAssetOutsideTheSubtreeIsDropped,
  anOrganizationChangeClearsTheChildren,
  anUnknownIdIsDropped,
  readsTheFourKeysOnly,
  theChoicesCascade,
  writeKeepsOtherParameters,
} from "./scope-filter.spec";

/** `F4.361` U6 — the scope-filter cascade. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.361 scope filter cascade", () => {
  it("reads the four scope keys only", () => readsTheFourKeysOnly());
  it("writes the four keys and keeps every other parameter", () => writeKeepsOtherParameters());
  it("drops a location of another organization", () => aCrossOrganizationLocationIsDropped());
  it("drops a group outside the location's subtree", () => aGroupOutsideTheSubtreeIsDropped());
  it("drops an asset outside the chosen group", () => anAssetOutsideTheGroupIsDropped());
  it("drops an asset outside the location's subtree", () => anAssetOutsideTheSubtreeIsDropped());
  it("drops an id the options do not list", () => anUnknownIdIsDropped());
  it("fills the organization of a child named without it", () => aChildFillsItsOrganization());
  it("never writes a single, locked organization", () => aLockedOrganizationIsNotWritten());
  it("clears the children when the organization changes", () => anOrganizationChangeClearsTheChildren());
  it("clears what a new location no longer contains", () => aLocationChangeClearsWhatItNoLongerContains());
  it("narrows the asset to the chosen group", () => aGroupChangeNarrowsTheAsset());
  it("cascades the choices", () => theChoicesCascade());
});
