import { describe, it } from "vitest";

import {
  aBoundConversationRefusesAResumeBeforeTheRead,
  aBoundConversationRefusesASecondStart,
  aCommittedSessionCannotBeResumed,
  aLostBindOnAResumeIsA409,
  anUnavailableCopilotRefusesAResumeBeforeTheRead,
  anUnreadableSessionPropagatesItsAnswer,
  aResumeBindsTheNamedDraft,
  aResumeRecordsTheResumedLine,
  aLostBindOnAResumeDiscardsNothing,
  aLostBindOnAResumeFreesNothing,
  aResumeDiscardsTheFreedConversationsCommitCard,
  aResumeReadsTheFreedConversationsCards,
  aResumeUnbindsElsewhereAfterItBinds,
  aResumeUnbindsTheCallersOtherConversations,
  aSessionOfAnotherOrganizationIsRefused,
  aStartWithoutASessionIdUnbindsNothingElsewhere,
  aCrossOrganizationConversationIsRefused,
  aLocationAdminIsRefusedByTheOnboardingGate,
  aLostBindRaceIsA409,
  anEndDiscardsTheOpenCommitCardOnly,
  anEndUnbinds,
  anotherOrganizationIsRefused,
  anotherUsersConversationIsA404,
  anUnavailableCopilotRefusesTheStart,
  aReadOfTheSkillToleratesALostSession,
  aStartCreatesAndBindsASession,
} from "./copilot-skill.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — starting, ending and reading the onboarding skill (ADR 0099 decision 7)", () => {
  it("creates, binds and opens a session", () => aStartCreatesAndBindsASession());
  it("propagates the onboarding role gate's 403 for a location admin, binding nothing", () =>
    aLocationAdminIsRefusedByTheOnboardingGate());
  it("refuses a cross-organization conversation before any session", () => aCrossOrganizationConversationIsRefused());
  it("refuses another organization than the conversation's", () => anotherOrganizationIsRefused());
  it("refuses the start where the copilot is off (ruling Q4)", () => anUnavailableCopilotRefusesTheStart());
  it("refuses a second start on a bound conversation", () => aBoundConversationRefusesASecondStart());
  it("answers 409 when another start wins the bind", () => aLostBindRaceIsA409());
  it("answers 404 for another user's conversation", () => anotherUsersConversationIsA404());
  it("unbinds on an end and leaves the session", () => anEndUnbinds());
  it("discards the open onboarding commit card on an end, and only it", () => anEndDiscardsTheOpenCommitCardOnly());
  it("reads the skill, tolerating a session the caller can no longer read", () => aReadOfTheSkillToleratesALostSession());
});

describe("F4.255 — a start with sessionId resumes a draft (ADR 0099 Amendment 2 A1)", () => {
  it("R1a reads, binds and answers the named draft, creating nothing", () => aResumeBindsTheNamedDraft());
  it("R1b unbinds the caller's other conversations from the session", () => aResumeUnbindsTheCallersOtherConversations());
  it("R1c stores the resumed action line", () => aResumeRecordsTheResumedLine());
  it("R2a refuses a resume where the copilot is off, before the read", () => anUnavailableCopilotRefusesAResumeBeforeTheRead());
  it("R2b refuses a resume on a bound conversation, before the read", () => aBoundConversationRefusesAResumeBeforeTheRead());
  it("R3 propagates the read's 404 and touches nothing", () => anUnreadableSessionPropagatesItsAnswer());
  it("R4 refuses a session of another organization", () => aSessionOfAnotherOrganizationIsRefused());
  it("R5 refuses a session that is no longer a draft", () => aCommittedSessionCannotBeResumed());
  it("R6 answers 409 for a lost bind on a resume, storing nothing", () => aLostBindOnAResumeIsA409());
  it("R7 unbinds elsewhere only after it binds", () => aResumeUnbindsElsewhereAfterItBinds());
  it("R7b frees no other conversation when it loses its bind", () => aLostBindOnAResumeFreesNothing());
  it("R7c reads and discards no card when it loses its bind", () => aLostBindOnAResumeDiscardsNothing());
  it("R8a discards the freed conversation's open commit card at resume time", () =>
    aResumeDiscardsTheFreedConversationsCommitCard());
  it("R8b reads the freed conversation's cards, not the resumed one's", () => aResumeReadsTheFreedConversationsCards());
  it("control: a plain start creates and unbinds nothing elsewhere", () => aStartWithoutASessionIdUnbindsNothingElsewhere());
});
