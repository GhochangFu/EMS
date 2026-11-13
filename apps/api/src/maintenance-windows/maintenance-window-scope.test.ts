import { describe, it } from "vitest";

import {
  aTargetIsShownOnlyWhenReadable,
  anAssetGroupAdminNamesNoLocation,
  everyTargetMeansEveryAndNotNone,
  onlyALocationSourcedScopeNamesLocations,
  readScopeForAsksTheRoleFirst,
  targetInScopeKeepsToTheReadableSets,
  unrestrictedIsTheNullAssetSet,
} from "./maintenance-window-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.359 — the maintenance-window scope predicates (plan D15, section 7)", () => {
  it("isUnrestricted is the admin's null asset set", () => unrestrictedIsTheNullAssetSet());
  it("only a location- or organization-sourced scope names location targets", () => onlyALocationSourcedScopeNamesLocations());
  it("an asset-group admin names no location, and names a member asset or its rule", () => anAssetGroupAdminNamesNoLocation());
  it("targetInScope keeps to the readable sets; the admin names any", () => targetInScopeKeepsToTheReadableSets());
  it("everyTargetInScope needs every target, and no target never passes", () => everyTargetMeansEveryAndNotNone());
  it("a listed target is shown only when the caller reads it", () => aTargetIsShownOnlyWhenReadable());
  it("readScopeFor asks the role before any scope walk", () => readScopeForAsksTheRoleFirst());
});
