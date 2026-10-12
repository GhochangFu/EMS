// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aChangedDraftShowsTheRoutesSentence,
  anEndDropsAKeptCommitCard,
  aRefusedWizardSubmitRetriesWithTheNewHash,
  aWizardCommitDoesNotReopenThePreview,
  aWizardCommitDropsTheCommitCard,
  enterSendsNothingWhileAnUndoIsInFlight,
  sendIsDisabledWhileAnUndoIsInFlight,
  aChipSendsItsTextAsATurn,
  aLocationAdminIsNotOfferedOnboarding,
  aLostSessionReturnsToThePlainConversation,
  aNewCommitCardReplacesTheOld,
  aSwitchedOffOrganizationOffersNoOnboarding,
  aRefusalWithoutASkillKeyKeepsThePanel,
  aSkillConversationRendersTheChips,
  aSkillTakesInputWithNoKey,
  credentialsGoToTheirRouteAndNeverToATurn,
  onboardASiteStartsTheSkill,
  theCommitCardConfirmsWithTheHeader,
  theDrawerCommitIsTheWizardWithoutTheHeader,
  theGlobalAdminPicksAnOrganizationFirst,
} from "./onboarding-skill-panel.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F3.86 PR 6 — the dock's onboarding skill (ADR 0099 decision 7)", () => {
  it("renders the chips from suggestedReplies and never the generic empty state", aSkillConversationRendersTheChips);
  it("sends a chip's text as a turn", aChipSendsItsTextAsATurn);
  it("takes input with no AI key", aSkillTakesInputWithNoKey);
  it("posts credentials to their route and never in a turn", credentialsGoToTheirRouteAndNeverToATurn);
  it("confirms the commit card with { draftHash } and the header", theCommitCardConfirmsWithTheHeader);
  it("shows the route's sentence when the draft changed", aChangedDraftShowsTheRoutesSentence);
  it("commits from the drawer through the wizard, without the header", theDrawerCommitIsTheWizardWithoutTheHeader);
  it("returns to the plain conversation when the skill ends", aLostSessionReturnsToThePlainConversation);
  it("keeps the panel on a refusal with no skill key", aRefusalWithoutASkillKeyKeepsThePanel);
  it("replaces the old commit card with the new one", aNewCommitCardReplacesTheOld);
});

describe("F3.86 PR 6 review — the dock's onboarding skill", () => {
  it("retries a refused wizard Submit with the fresh session's hash", aRefusedWizardSubmitRetriesWithTheNewHash);
  it("drops the commit card after a wizard commit", aWizardCommitDropsTheCommitCard);
  it("drops a kept commit card on End onboarding", anEndDropsAKeptCommitCard);
  it("does not reopen the preview after a wizard commit", aWizardCommitDoesNotReopenThePreview);
  it("disables Send while an undo is in flight", sendIsDisabledWhileAnUndoIsInFlight);
  it("sends nothing on Enter while an undo is in flight", enterSendsNothingWhileAnUndoIsInFlight);
});

describe("F3.86 PR 6 — starting the onboarding skill (ruling Q4)", () => {
  it("makes the conversation and starts the skill in its organization", onboardASiteStartsTheSkill);
  it("offers a location_admin no start", aLocationAdminIsNotOfferedOnboarding);
  it("makes the global admin pick an organization first", theGlobalAdminPicksAnOrganizationFirst);
  it("offers no onboarding where the organization's copilot is off", aSwitchedOffOrganizationOffersNoOnboarding);
});
