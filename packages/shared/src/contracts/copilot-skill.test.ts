import { describe, it } from "vitest";

import {
  theCommitBodyRequiresTheHash,
  theSkillStateParsesTheOnboardingShape,
  theStartBodyMayNameADraftToResume,
  theStartBodyNamesOneOrganization,
  theStartBodyRefusesANonUuidSessionId,
  theStartBodyStaysStrict,
  theTurnAndTheDetailCarryTheSkill,
} from "./copilot-skill.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 5 — the onboarding skill's contracts (ADR 0099 decision 7)", () => {
  it("requires a 64-character draftHash on the commit body", () => theCommitBodyRequiresTheHash());
  it("parses the onboarding skill state and refuses another kind", () => theSkillStateParsesTheOnboardingShape());
  it("carries the skill on a turn and a conversation detail", () => theTurnAndTheDetailCarryTheSkill());
  it("names one organization in the start body", () => theStartBodyNamesOneOrganization());
  it("F4.255: keeps a sessionId on a resume body", () => theStartBodyMayNameADraftToResume());
  it("F4.255: refuses a non-uuid sessionId", () => theStartBodyRefusesANonUuidSessionId());
  it("F4.255: still refuses an unknown key", () => theStartBodyStaysStrict());
});
