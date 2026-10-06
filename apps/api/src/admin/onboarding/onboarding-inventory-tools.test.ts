import { describe, it } from "vitest";

import {
  assertACutResultKeepsTheScopeNoteAndTheTail,
  assertAFailedInventoryReadIsAToolError,
  assertFindExistingAsksTheServiceForTheSessionOrganization,
  assertFindExistingCarriesTheScopeNote,
  assertFindExistingEchoesRowsUnchangedAndWritesNothing,
  assertFindExistingIsCappedAndCountsTheRest,
  assertFindExistingRefusesAnUnknownKind,
  assertFindExistingRefusesOverlongArguments,
  assertFindExistingRefusesThePromptMarker,
} from "./onboarding-inventory-tools.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("onboarding find_existing (F3.26, ADR 0095)", () => {
  it("T1 find_existing asks the service for the session organization", async () => {
    await assertFindExistingAsksTheServiceForTheSessionOrganization();
  });
  it("T2 find_existing is capped at 100 and counts the rest", async () => {
    await assertFindExistingIsCappedAndCountsTheRest();
  });
  it("T3 every kind carries the scope note", async () => {
    await assertFindExistingCarriesTheScopeNote();
  });
  it("T4 an unknown kind is refused", async () => {
    await assertFindExistingRefusesAnUnknownKind();
  });
  it("T5 an overlong argument or an unknown property is refused", async () => {
    await assertFindExistingRefusesOverlongArguments();
  });
  it("T6 the rows are echoed unchanged and nothing is written", async () => {
    await assertFindExistingEchoesRowsUnchangedAndWritesNothing();
  });
  it("T7 the withheld-value marker is refused", async () => {
    await assertFindExistingRefusesThePromptMarker();
  });
  it("T8 a failed inventory read is a tool error", async () => {
    await assertAFailedInventoryReadIsAToolError();
  });
  it("T9 a cut result keeps the scope note and the tail", async () => {
    await assertACutResultKeepsTheScopeNoteAndTheTail();
  });
});
