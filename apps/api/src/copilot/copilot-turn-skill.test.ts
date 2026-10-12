import { describe, it } from "vitest";

import {
  aClosedSessionAnswersAFixedReply,
  aFollowUpOnASkillConversationStoresTheOutcomeOnly,
  aPlainConversationNeverReachesTheSkill,
  aSkillTurnAnswersWithNoKey,
  aSkillTurnDropsActionLinesItCannotOwn,
  aSkillTurnIsCountedOnce,
  aSkillTurnObeysTheCopilotSwitch,
  aSkillTurnObeysTheDailyLimit,
  aSkillTurnRunsTheOnboardingChatOnce,
  aSkillTurnStoresItsOwnRows,
  theCommitPhraseInASkillTurnIsNotACommit,
  theCredentialRefusalComesBeforeTheSkill,
} from "./copilot-turn-skill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — a turn of the onboarding skill (ADR 0099 decision 7, ruling Q4)", () => {
  it("runs the onboarding chat once and the copilot's model never", () => aSkillTurnRunsTheOnboardingChatOnce());
  it("answers with no key resolved (the guided mode)", () => aSkillTurnAnswersWithNoKey());
  it("obeys the organization's copilot switch", () => aSkillTurnObeysTheCopilotSwitch());
  it("obeys the daily limit", () => aSkillTurnObeysTheDailyLimit());
  it("is counted once against the conversation's organization", () => aSkillTurnIsCountedOnce());
  it("hands the commit phrase to chat with commitByPhrase false", () => theCommitPhraseInASkillTurnIsNotACommit());
  it("stores the user message, this turn's action lines and the reply", () => aSkillTurnStoresItsOwnRows());
  it("takes no action line it cannot own", () => aSkillTurnDropsActionLinesItCannotOwn());
  it("answers a fixed reply, uncounted, for a closed session", () => aClosedSessionAnswersAFixedReply());
  it("refuses a credential before the skill", () => theCredentialRefusalComesBeforeTheSkill());
  it("stores only the outcome line for a follow-up", () => aFollowUpOnASkillConversationStoresTheOutcomeOnly());
  it("never reaches the skill on a plain conversation", () => aPlainConversationNeverReachesTheSkill());
});
