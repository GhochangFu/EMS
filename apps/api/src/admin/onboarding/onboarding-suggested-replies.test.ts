import { describe, it } from "vitest";

import {
  assertACredentialIsDropped,
  assertAgentRepliesAddTheStepLabelAndViewDraft,
  assertAgentRepliesHoldAtSix,
  assertAnOverLongReplyIsDroppedNotCut,
  assertAStepLabelIsKept,
  assertDuplicatesKeepTheFirst,
  assertLocationAndReviewHaveNoStepLabel,
  assertTheCommitPhraseIsDropped,
  assertTheUndoPhraseIsDropped,
} from "./onboarding-suggested-replies.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the agent path's reply list (F3.25, ADR 0094 decision 9)", () => {
  it("drops the commit phrase", () => {
    assertTheCommitPhraseIsDropped();
  });
  it("drops the undo phrase", () => {
    assertTheUndoPhraseIsDropped();
  });
  it("keeps a step label", () => {
    assertAStepLabelIsKept();
  });
  it("drops a reply that looks like a credential", () => {
    assertACredentialIsDropped();
  });
  it("drops an over-long reply and never cuts it", () => {
    assertAnOverLongReplyIsDroppedNotCut();
  });
  it("dedupes by the normalised form, keeping the first", () => {
    assertDuplicatesKeepTheFirst();
  });
  it("adds the step label and View draft after the model's replies", () => {
    assertAgentRepliesAddTheStepLabelAndViewDraft();
  });
  it("holds at six replies", () => {
    assertAgentRepliesHoldAtSix();
  });
  it("adds no step label at location or review", () => {
    assertLocationAndReviewHaveNoStepLabel();
  });
});
