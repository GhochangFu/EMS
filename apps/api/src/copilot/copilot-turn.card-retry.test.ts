import { describe, it } from "vitest";

import {
  aFailedCorrectionFallsBackToTheNotedFirstText,
  aFollowUpTextCardIsCorrected,
  anOpenCardSkipsTheCorrection,
  aPlainAnswerIsNotCorrected,
  aRealCardIsNotCorrected,
  aSecondTextCardGetsTheNote,
  theCorrectionTurnsATextCardIntoACard,
  theModelIsSentItsTextAndTheCheck,
  theTurnLogRecordsTheCorrection,
} from "./copilot-turn.card-retry.spec";

/** `F4.295` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.295 — a copilot reply that describes a card it never proposed gets one correction in the same turn", () => {
  it("returns the card the correction produced, and never the first text", () => theCorrectionTurnsATextCardIntoACard());
  it("sends the model its own text and the server check", () => theModelIsSentItsTextAndTheCheck());
  it("notes a second text-only card and asks no third time", () => aSecondTextCardGetsTheNote());
  it("never corrects a turn that proposed a card", () => aRealCardIsNotCorrected());
  it("never corrects a reply that claims no card", () => aPlainAnswerIsNotCorrected());
  it("corrects a text-only card on a follow-up turn", () => aFollowUpTextCardIsCorrected());
  it("records the correction in the turn log, only where it ran", () => theTurnLogRecordsTheCorrection());
  it("skips the correction while an earlier card is open", () => anOpenCardSkipsTheCorrection());
  it("falls back to the noted first text when the correction round fails", () => aFailedCorrectionFallsBackToTheNotedFirstText());
});
