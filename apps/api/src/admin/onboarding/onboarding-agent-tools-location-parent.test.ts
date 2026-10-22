import { describe, it } from "vitest";

import {
  assertACodeInAnotherCaseIsNamedAsStored,
  assertACodeInAnotherCaseStoresTheCandidatesCode,
  assertARefusedParentLeavesTheWorkingDraftUnchanged,
  assertAStoredUncheckedParentIsNotEchoed,
  assertAnActiveParentIsWrittenWithItsActionLine,
  assertAnInactiveParentIsRefused,
  assertANullParentIsATopLevelLocation,
  assertAnUnknownParentIsRefused,
  assertARenameKeepsTheStoredParent,
  assertTheDerivedPatchCarriesTheStoredParent,
} from "./onboarding-agent-tools-location-parent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.243 — set_location takes a parent by code (ADR 0098 Amendment 2, B7)", () => {
  it("A1 refuses an unknown parent with the guard's sentence", async () => {
    await assertAnUnknownParentIsRefused();
  });
  it("A1b leaves the working draft unchanged on a refusal", async () => {
    await assertARefusedParentLeavesTheWorkingDraftUnchanged();
  });
  it("A2 refuses an inactive parent", async () => {
    await assertAnInactiveParentIsRefused();
  });
  it("A3 writes an active parent and names it in the action line", async () => {
    await assertAnActiveParentIsWrittenWithItsActionLine();
  });
  it("A4 writes null as a top-level location", async () => {
    await assertANullParentIsATopLevelLocation();
  });
  it("A5 keeps the stored parent across a rename", async () => {
    await assertARenameKeepsTheStoredParent();
  });
  it("A5b deriveLocationPatch carries the stored parent", () => {
    assertTheDerivedPatchCarriesTheStoredParent();
  });
  it("A6 does not echo a stored parent the call did not name", async () => {
    await assertAStoredUncheckedParentIsNotEchoed();
  });
  it("A7 stores the candidate's own code for a code in another case", async () => {
    await assertACodeInAnotherCaseStoresTheCandidatesCode();
  });
  it("A7b names the stored code in the action line", async () => {
    await assertACodeInAnotherCaseIsNamedAsStored();
  });
});
