import { describe, it } from "vitest";

import {
  aClaimWithAChangeIsUntouched,
  aClaimWithNoChangeIsNotedStoredAndReturned,
  aFollowUpClaimIsNoted,
  aReplyWithNoClaimIsUntouched,
  thePromptCarriesTheRule,
  theRedactedReplyIsReturnedUnchanged,
  theScrubRunsBeforeTheAppend,
  theTurnLogSaysWhetherTheNoteWasAppended,
} from "./copilot-turn.card-claim.spec";

/** `F4.286` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.286 — a copilot reply never claims a card that no tool proposed", () => {
  it("appends, stores and returns the note for a claim with no pending change", () => aClaimWithNoChangeIsNotedStoredAndReturned());
  it("leaves a claim with a pending change untouched", () => aClaimWithAChangeIsUntouched());
  it("leaves a reply with no claim untouched", () => aReplyWithNoClaimIsUntouched());
  it("returns the redacted reply unchanged", () => theRedactedReplyIsReturnedUnchanged());
  it("scrubs before it appends (the redacted turn logs no note)", () => theScrubRunsBeforeTheAppend());
  it("notes a claim on a follow-up turn", () => aFollowUpClaimIsNoted());
  it("carries the card-claim rule in the system prompt", () => thePromptCarriesTheRule());
  it("logs whether the note was appended", () => theTurnLogSaysWhetherTheNoteWasAppended());
});
