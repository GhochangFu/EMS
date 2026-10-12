import { describe, it } from "vitest";

import {
  aProposalForAnotherDraftMakesNoCard,
  aProposingTurnStoresOneCommitCard,
  aStaleCommitCardIsReplaced,
  aTurnThatWroteNothingMakesNoCard,
  aTurnWithoutAProposalMakesNoCard,
  theSameCommitCardIsKept,
} from "./copilot-onboarding-commit.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 6 — the server-made onboarding commit card (ADR 0099 decision 7)", () => {
  it("stores one onboarding.commit card bound to the turn's draft hash", () => aProposingTurnStoresOneCommitCard());
  it("makes no card when no proposal is stored", () => aTurnWithoutAProposalMakesNoCard());
  it("makes no card when the proposal names another draft", () => aProposalForAnotherDraftMakesNoCard());
  it("makes no card for a turn that wrote nothing", () => aTurnThatWroteNothingMakesNoCard());
  it("replaces a stale commit card", () => aStaleCommitCardIsReplaced());
  it("keeps the commit card for the same hash", () => theSameCommitCardIsKept());
});
