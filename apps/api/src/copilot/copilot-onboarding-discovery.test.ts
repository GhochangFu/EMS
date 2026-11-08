import { describe, it } from "vitest";

import {
  aDiscoveryCardIsDeadWithoutADraftSkill,
  aDiscoveryCardIsLiveWithADraftSkill,
  anApplyingChangeBlocksTheCardAndTheReplySaysSo,
  anOpenCommitCardIsWithdrawnForTheDiscoveryCard,
  thePlainReplyIsUnchangedWhenTheCardShows,
  aPlainRtuCardSaysTlsOff,
  aProposingTurnStoresOneDiscoveryCard,
  aStaleDiscoveryCardIsReplaced,
  aTurnThatWroteNothingMakesNoDiscoveryCard,
  aTurnWithoutTheProposedLineReadsNothing,
  noStoredProposalMakesNoDiscoveryCard,
  theCardSummaryShowsTheConnection,
  theSameDiscoveryCardIsKept,
  theTurnAnswersTheDiscoveryCard,
} from "./copilot-onboarding-discovery.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("copilot onboarding discovery card (F3.24b, ADR 0103 decision 2)", () => {
  it("X1 a proposing turn stores one discovery change whose hashed body binds the broker", async () => {
    await aProposingTurnStoresOneDiscoveryCard();
  });
  it("X2 the turn answers the card in pendingChanges", async () => {
    await theTurnAnswersTheDiscoveryCard();
  });
  it("X3 the summary shows host, port, TLS on, filter, window and the warning", async () => {
    await theCardSummaryShowsTheConnection();
  });
  it("X3b a plain RTU's card says TLS off and binds expected.tls false (ADR 0114)", async () => {
    await aPlainRtuCardSaysTlsOff();
  });
  it("X4 a turn without the proposed line reads nothing and makes no card", async () => {
    await aTurnWithoutTheProposedLineReadsNothing();
  });
  it("X5 a turn that wrote nothing makes no card", async () => {
    await aTurnThatWroteNothingMakesNoDiscoveryCard();
  });
  it("X6 no stored proposal makes no card", async () => {
    await noStoredProposalMakesNoDiscoveryCard();
  });
  it("X7 a stale discovery card is discarded and replaced", async () => {
    await aStaleDiscoveryCardIsReplaced();
  });
  it("X8 the same discovery card is kept", async () => {
    await theSameDiscoveryCardIsKept();
  });
  it("X9 a discovery card is dead without a draft skill, another change is not", () => {
    aDiscoveryCardIsDeadWithoutADraftSkill();
  });
  it("X10 a discovery card is live while the draft skill runs", () => {
    aDiscoveryCardIsLiveWithADraftSkill();
  });
  it("X11 an open commit card is withdrawn for the discovery card (F4.339)", async () => {
    await anOpenCommitCardIsWithdrawnForTheDiscoveryCard();
  });
  it("X12 an applying change blocks the card and the reply says so (F4.339)", async () => {
    await anApplyingChangeBlocksTheCardAndTheReplySaysSo();
  });
  it("X13 the reply is unchanged when the card shows (F4.339)", async () => {
    await thePlainReplyIsUnchangedWhenTheCardShows();
  });
});
