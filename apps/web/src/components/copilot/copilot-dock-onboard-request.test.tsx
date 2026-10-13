// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aNotFoundResumeShowsTheStartError,
  aPendingResumeDoesNotRelabelTheStart,
  aRefusedResumeShowsTheStartError,
  aRefusedResumeReadsTheDraftListAgain,
  aTurnThatEndsTheSkillReadsTheDraftListAgain,
  aClosedSessionTurnMakesTheDraftListStale,
  aPlainTurnLeavesTheDraftListAlone,
  aGlobalAdminListsThePickedOrganization,
  aGlobalAdminOnAllOrganizationsReadsNoList,
  aScopedAdminWithNoConversationListsItsHome,
  aRequestDoesNotStartASecondSkill,
  aRequestFiledAfterTheMountStartsTheSkillOnce,
  aStartMakesTheDraftListStale,
  aSwitchedOffOrganizationStartsNothing,
  anExpiredOrForeignRequestIsDropped,
  endReadsTheDraftListAgain,
  oneRequestStartsTheSkillExactlyOnce,
  resumeStartsTheSkillWithTheDraftsId,
  startNewSendsNoSessionId,
  theGlobalAdminsRequestPicksThatOrganization,
} from "./copilot-dock-onboard-request.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F3.86 PR 7 copilot dock — the onboarding request", () => {
  it("one request leads to exactly one start call, after a re-render and under StrictMode", oneRequestStartsTheSkillExactlyOnce);
  it("a request filed after the mount starts the skill once", aRequestFiledAfterTheMountStartsTheSkillOnce);
  it("a request does not start a second skill when one is bound", aRequestDoesNotStartASecondSkill);
  it("with the organization's switch off, nothing starts and the off sentence shows", aSwitchedOffOrganizationStartsNothing);
  it("the global admin's request picks that organization", theGlobalAdminsRequestPicksThatOrganization);
  it("an expired or another user's request is dropped", anExpiredOrForeignRequestIsDropped);
});

describe("F4.255 PR 3 copilot dock — the onboarding draft list", () => {
  it("Resume starts the skill with the draft's id and shows the session", resumeStartsTheSkillWithTheDraftsId);
  it("Start new sends no session id", startNewSendsNoSessionId);
  it("End onboarding reads the draft list again", endReadsTheDraftListAgain);
  it("a start makes the draft list stale", aStartMakesTheDraftListStale);
  it("a pending resume does not relabel the start button", aPendingResumeDoesNotRelabelTheStart);
  it("a 409 resume shows the server's sentence as the start error", aRefusedResumeShowsTheStartError);
  it("a 404 resume shows the server's sentence as the start error", aNotFoundResumeShowsTheStartError);
  it("a refused resume reads the draft list again", aRefusedResumeReadsTheDraftListAgain);
  it("a turn that ends the skill reads the draft list again", aTurnThatEndsTheSkillReadsTheDraftListAgain);
  it("a turn that answers the session is closed makes the draft list stale", aClosedSessionTurnMakesTheDraftListStale);
  it("a plain turn leaves the draft list alone", aPlainTurnLeavesTheDraftListAlone);
  it("a global admin lists the picked organization's drafts", aGlobalAdminListsThePickedOrganization);
  it("a global admin on All organizations reads no list and Start is disabled", aGlobalAdminOnAllOrganizationsReadsNoList);
  it("a scoped admin with no conversation lists its home organization", aScopedAdminWithNoConversationListsItsHome);
});
