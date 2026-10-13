import { describe, it } from "vitest";

import {
  aForeignCommittedSessionIsNotFound,
  aForeignSessionReadsAsMissing,
  aLocationAdminCausesNoSessionRead,
  aLocationAdminCommitCausesNoSessionRead,
  aLocationAdminGetsTheRoleRefusal,
  aMissingAndAForeignCommitAnswerTheSame,
  anInScopeCommittedSessionIsStillTheBadRequest,
  anInScopeDraftWithTheRightHashCommits,
  anInScopeSessionIsReturned,
} from "./onboarding-session-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.256 — an out-of-scope onboarding session id is the uniform 404", () => {
  describe("commitWith", () => {
    it("answers a foreign committed session with 404, not the 400", () => aForeignCommittedSessionIsNotFound());
    it("still answers an in-scope committed session with the 400", () => anInScopeCommittedSessionIsStillTheBadRequest());
    it("answers a missing id and a foreign draft with the same class and body", () =>
      aMissingAndAForeignCommitAnswerTheSame());
    it("lets an in-scope draft with the right hash reach the commit transaction", () =>
      anInScopeDraftWithTheRightHashCommits());
    it("refuses a location admin's commit before the session read", () => aLocationAdminCommitCausesNoSessionRead());
  });

  describe("loadSession (through getSession)", () => {
    it("refuses a location admin with the role 403", () => aLocationAdminGetsTheRoleRefusal());
    it("refuses a location admin before the session read", () => aLocationAdminCausesNoSessionRead());
    it("answers a foreign id with the same class and body as a missing id", () => aForeignSessionReadsAsMissing());
    it("returns an in-scope session", () => anInScopeSessionIsReturned());
  });
});
