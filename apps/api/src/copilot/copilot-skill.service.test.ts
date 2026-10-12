import { describe, it } from "vitest";

import {
  aBoundConversationRefusesASecondStart,
  aCrossOrganizationConversationIsRefused,
  aLocationAdminIsRefusedByTheOnboardingGate,
  aLostBindRaceIsA409,
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
  it("reads the skill, tolerating a session the caller can no longer read", () => aReadOfTheSkillToleratesALostSession());
});
