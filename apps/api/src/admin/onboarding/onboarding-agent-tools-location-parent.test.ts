import { describe, it } from "vitest";

import {
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
});
