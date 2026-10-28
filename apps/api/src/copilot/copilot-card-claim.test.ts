import { describe, it } from "vitest";

import {
  aFutureOrPastApplyIsNotTagged,
  anActionRecordCountsOnlyAfterTheLastUserMessage,
  aNegationIsNotAClaim,
  aReadAnswerIsNotAClaim,
  onlyAnAppliedRowCounts,
  theFirstPersonAndCardUpWordingsAreTagged,
  theAppliedNoteNeedsNoRecord,
  theAwsAppliedRepliesAreTagged,
  theAwsCardWordingsAreTagged,
  aClaimWithAChangeIsUntouched,
  aClaimWithNoChangeGetsTheNote,
  aPlainAnswerClaimsNothing,
  aRefusalNamingProposeClaimsNothing,
  aReplyWithNoClaimIsUntouched,
  aClaimStopsAtASentenceEnd,
  bareWordsAreNotTagged,
  eachPatternFiresOnItsOwnSample,
  theFixedRepliesClaimNothing,
  theLiveReplyClaimsACard,
} from "./copilot-card-claim.spec";

/** `F4.286` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.286 — the card-claim phrase list and the no-change note", () => {
  it("tags the F4.283 live reply as a card claim", () => theLiveReplyClaimsACard());
  it("does not tag a plain answer", () => aPlainAnswerClaimsNothing());
  it("does not tag a refusal that names the verb propose", () => aRefusalNamingProposeClaimsNothing());
  it("fires each pattern on its own sample, and only that pattern", () => eachPatternFiresOnItsOwnSample());
  it("does not tag bare words (widget cards, a clarifying confirm, a past Confirm)", () => bareWordsAreNotTagged());
  it("does not join a noun and a state word across a sentence end", () => aClaimStopsAtASentenceEnd());
  it("appends the note to a claim with no pending change", () => aClaimWithNoChangeGetsTheNote());
  it("leaves a claim with a pending change untouched", () => aClaimWithAChangeIsUntouched());
  it("leaves a reply with no claim untouched", () => aReplyWithNoClaimIsUntouched());
  it("never tags the fixed replies", () => theFixedRepliesClaimNothing());
});

/** `F4.293` — the AWS wordings and the applied-claim check. */
describe("F4.293 — card wordings F4.286 missed, and applied claims", () => {
  it("tags the two AWS card wordings, each by its own pattern", () => theAwsCardWordingsAreTagged());
  it("tags the three AWS applied replies", () => theAwsAppliedRepliesAreTagged());
  it("does not tag a future, a past report or a question", () => aFutureOrPastApplyIsNotTagged());
  it("appends the applied note only when no action record follows", () => theAppliedNoteNeedsNoRecord());
  it("counts an action record only after the last user message", () => anActionRecordCountsOnlyAfterTheLastUserMessage());
  it("counts only an Applied action row, not Rejected, Failed or a skill row", () => onlyAnAppliedRowCounts());
  it("never tags a negated sentence, the note included", () => aNegationIsNotAClaim());
  it("does not tag a read answer with no change noun", () => aReadAnswerIsNotAClaim());
  it("tags \"I've created\" and \"the rule card is up\", not \"up to\"", () => theFirstPersonAndCardUpWordingsAreTagged());
});
