import { describe, it } from "vitest";

import * as S from "./onboarding-credential-copy-state.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("F4.339 PR 9 — the stored credential-copy proposal (ADR 0099 Amendment 18 decision 2)", () => {
  it("ST1 the draft hash ignores the proposal and still sees a section change", S.theHashIgnoresTheCopyProposal);
  it("ST2 neither the client nor the model view carries it", S.theClientAndModelViewsHaveNoCopyProposal);
  it("ST3 a draft write and a restore clear it", S.aWriteAndARestoreClearTheCopyProposal);
  it("ST4 the reader fails closed", S.theReaderFailsClosed);
  it("ST5 a proposing chat turn stores it outside the hash, blobs untouched", S.aProposingTurnStoresTheCopyProposal);
  it("ST6 a turn that proposed nothing stores none", S.aTurnWithoutACopyProposalStoresNone);
  it("ST7 the prompt sentence shows only with a credentialed MQTT RTU; guided mode is agent-only", S.thePromptAndTheGuidedCoverage);
  it("ST8 the claim guard knows 'Proposed credential copy' (decision 4)", S.theClaimGuardKnowsTheCopyPhrase);
});
