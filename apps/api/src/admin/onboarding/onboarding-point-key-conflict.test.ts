import { describe, it } from "vitest";

import {
  assertP1ACatalogContradictionIsTheCatalogSentence,
  assertP2ADeclarationThatStatesNothingHasNoProblem,
  assertP3ATwiceDeclaredNewCodeIsTheDraftSentence,
  assertP4TheProblemCarriesItsIndex,
  assertP5TheProblemNamesTheDomainField,
  assertP6AnAgreeingDuplicateIsTolerated,
  runOnboardingPointKeyConflictTests,
} from "./onboarding-point-key-conflict.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding-point-key-conflict", () => {
  it("refuses a draft declaration that contradicts the fleet-wide catalog row", () => {
    runOnboardingPointKeyConflictTests();
  });
});

/** F4.225 — `pointKeyDeclarationProblems` mirrors the commit walk. One `it()` per claim. */
describe("pointKeyDeclarationProblems (F4.225)", () => {
  it("P1 a catalog contradiction is the catalog sentence", () => assertP1ACatalogContradictionIsTheCatalogSentence());
  it("P2 a declaration that states nothing has no problem", () => assertP2ADeclarationThatStatesNothingHasNoProblem());
  it("P3 a new code declared twice with two units is the draft sentence at the second index", () =>
    assertP3ATwiceDeclaredNewCodeIsTheDraftSentence());
  it("P4 the problem carries its declaration's index", () => assertP4TheProblemCarriesItsIndex());
  it("P5 the problem names the domain field", () => assertP5TheProblemNamesTheDomainField());
  it("P6 an agreeing duplicate is tolerated", () => assertP6AnAgreeingDuplicateIsTolerated());
});
