import { describe, it } from "vitest";

import {
  assertACodeReplyKeepsTheLocationName,
  assertACodeReplyStoresTheParent,
  assertAnOrgWithNoLocationIsNotAsked,
  assertAnUnmatchedReplyAsksAgain,
  assertAnUnmatchedReplyWritesNothing,
  assertAPlacedLocationMovesToTheRtuStep,
  assertNoParentStoresNull,
  assertTheParentQuestionOffersTheChips,
  assertTheParentTextsCarryNoBannedWord,
  assertTheParentWriteRecordsItsActionLine,
  assertTheTypeTurnEndsWithTheParentQuestion,
} from "./onboarding-chat-location-parent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.243 — the guided chat asks for the parent location (ADR 0098 Amendment 2, B6)", () => {
  it("G1 a code reply stores the parent", async () => {
    await assertACodeReplyStoresTheParent();
  });
  it("G1b a code reply keeps the location name", async () => {
    await assertACodeReplyKeepsTheLocationName();
  });
  it("G1c a placed location moves to the RTU step", async () => {
    await assertAPlacedLocationMovesToTheRtuStep();
  });
  it("G2 No parent stores null", async () => {
    await assertNoParentStoresNull();
  });
  it("G3 an unmatched reply asks again", async () => {
    await assertAnUnmatchedReplyAsksAgain();
  });
  it("G3b an unmatched reply writes nothing", async () => {
    await assertAnUnmatchedReplyWritesNothing();
  });
  it("G4 an organization with no active location is not asked", async () => {
    await assertAnOrgWithNoLocationIsNotAsked();
  });
  it("G5 the type turn ends with the parent question", async () => {
    await assertTheTypeTurnEndsWithTheParentQuestion();
  });
  it("G5b the parent question offers the codes, No parent and View draft", async () => {
    await assertTheParentQuestionOffersTheChips();
  });
  it("G6 the parent write records its action line", async () => {
    await assertTheParentWriteRecordsItsActionLine();
  });
  it("G7 the parent step's texts carry no banned word", async () => {
    await assertTheParentTextsCarryNoBannedWord();
  });
});
