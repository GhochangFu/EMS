import { describe, it } from "vitest";

import * as S from "./copilot-onboarding-credential-copy.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("copilot onboarding credential-copy card (F4.339 PR 9, ADR 0099 Amendment 18)", () => {
  it("CP1 a proposing turn stores one copy change bound to the stored draft's hash", S.aProposingTurnStoresOneCopyCard);
  it("CP2 the turn answers the card; the summary names codes and the broker only", S.theCopyCardShowsCodesAndBroker);
  it("CP3 no card without the line, the write, the stored proposal or the hash", S.noCardWithoutTheLineTheWriteTheProposalOrTheHash);
  it("CP4 a stale copy card is replaced and the same one kept", S.aStaleCopyCardIsReplacedAndTheSameIsKept);
  it("CP5 an open commit card is withdrawn for the copy card", S.anOpenCommitCardIsWithdrawnForTheCopyCard);
  it("CP6 an applying change blocks the card and the reply says so", S.anApplyingChangeBlocksTheCopyCard);
  it("CP7 a copy card is dead without a draft skill and live with one", S.aCopyCardIsDeadWithoutADraftSkill);
});
