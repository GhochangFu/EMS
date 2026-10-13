import { describe, it } from "vitest";

import {
  aBoundConversationReadCarriesTheSkill,
  aPlainConversationReadCarriesNoSkill,
  aPlainReadDropsALeftCommitCard,
  aReadOfACommittedSkillDropsItsCommitCard,
  aReadOfADraftSkillKeepsItsCommitCard,
  theEndRouteAnswersWithNoSkill,
  theStartRouteAnswersTheConversationWithTheSkill,
  theStartRouteHandsTheSessionIdToTheResume,
  theStartRouteRefusesABadBodyOrId,
  theStartRouteRefusesANonUuidSessionId,
} from "./copilot-skill-routes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — the onboarding skill on the conversation routes (ADR 0099 decision 7)", () => {
  it("carries the bound session's state on a read", () => aBoundConversationReadCarriesTheSkill());
  it("carries no skill key on a plain conversation's read", () => aPlainConversationReadCarriesNoSkill());
  it("answers the start with the conversation and the skill", () => theStartRouteAnswersTheConversationWithTheSkill());
  it("refuses a bad start body or id before the start", () => theStartRouteRefusesABadBodyOrId());
  it("F4.255: hands a resume body's sessionId to the start", () => theStartRouteHandsTheSessionIdToTheResume());
  it("F4.255: refuses a non-uuid sessionId before the start", () => theStartRouteRefusesANonUuidSessionId());
  it("answers the end with skill null", () => theEndRouteAnswersWithNoSkill());
  it("rejects and hides the commit card of a committed session on a read", () => aReadOfACommittedSkillDropsItsCommitCard());
  it("keeps the commit card of a draft skill on a read", () => aReadOfADraftSkillKeepsItsCommitCard());
  it("rejects and hides a commit card left on a plain conversation", () => aPlainReadDropsALeftCommitCard());
});
