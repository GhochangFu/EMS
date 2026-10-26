import { describe, it } from "vitest";

import {
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
