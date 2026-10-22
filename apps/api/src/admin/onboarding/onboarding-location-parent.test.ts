import { describe, it } from "vitest";

import * as spec from "./onboarding-location-parent.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("parentChoicePending (F4.243, ADR 0098 Amendment 2 B5)", () => {
  it("P1 is pending for an absent key while the org has an active location", () => {
    spec.assertAbsentKeyWithActiveCandidateIsPending();
  });
  it("P1 is not pending for null (a root by choice)", () => {
    spec.assertNullParentIsNotPending();
  });
  it("P1 is not pending for a named parent", () => {
    spec.assertCodeParentIsNotPending();
  });
  it("P1 is not pending for an org with no location", () => {
    spec.assertOrgWithoutLocationIsNotAsked();
  });
  it("P1 is not pending for an org whose only location is inactive", () => {
    spec.assertOrgWithOnlyInactiveLocationIsNotAsked();
  });
  it("P1 is not pending for a draft with no location", () => {
    spec.assertNoLocationIsNotPending();
  });
});

describe("parentPlacementProblem (F4.243, B4)", () => {
  it("P2 has no problem for an absent parent", () => {
    spec.assertAbsentParentHasNoProblem();
  });
  it("P2 has no problem for a null parent", () => {
    spec.assertNullParentHasNoProblem();
  });
  it("P2 answers not found for an unknown code, without echo", () => {
    spec.assertUnknownCodeIsNotFound();
  });
  it("P2 matches a code in another case (B2)", () => {
    spec.assertCodeIsMatchedWithoutCase();
  });
  it("P2 refuses an inactive parent", () => {
    spec.assertInactiveParentIsRefused();
  });
  it("P2 passes a parent at depth 7", () => {
    spec.assertParentAtDepthSevenPasses();
  });
  it("P2 refuses a parent at depth 8", () => {
    spec.assertParentAtDepthEightIsTooDeep();
  });
  it("P2 passes an active root parent", () => {
    spec.assertActiveRootHasNoProblem();
  });
});

describe("parentQuestion (F4.243, B6)", () => {
  it("P3 names the location", () => {
    spec.assertQuestionNamesTheLocation();
  });
  it("P3 offers the codes the commit accepts, then No parent and View draft", () => {
    spec.assertChipsAreActiveCodesThenNoParentThenViewDraft();
  });
  it("P3 caps the code chips", () => {
    spec.assertChipsAreCapped();
  });
  it("P3 counts the codes a cut list leaves out", () => {
    spec.assertCutChipListIsCounted();
  });
});

describe("resolveParentTurn (F4.243, B6)", () => {
  it("P4 matches an active code without regard to case", () => {
    spec.assertCodeMatchesWithoutCase();
  });
  it("P4 matches an active name to its code", () => {
    spec.assertNameMatchesToTheCode();
  });
  it("P4 does not match an inactive candidate", () => {
    spec.assertInactiveCandidateIsNotMatched();
  });
  it("P4 does not match a name two locations share", () => {
    spec.assertAmbiguousNameIsNotMatched();
  });
  it("P5 reads the no-parent words as a root", () => {
    spec.assertNoParentWordsChooseRoot();
  });
  it("P5 leaves any other reply unmatched", () => {
    spec.assertOtherReplyIsUnmatched();
  });
});

describe("the parent code case rule (F4.243 review #7, B2)", () => {
  it("P6 lets an exact code win over a case match", () => {
    spec.assertAnExactCodeWinsOverACaseMatch();
  });
  it("P6 finds the one case-insensitive match", () => {
    spec.assertAUniqueCaseMatchIsFound();
  });
  it("P6 finds no match when two codes differ only in case", () => {
    spec.assertTwoCaseMatchesAreNoMatch();
  });
  it("P6 stores the candidate's own code", () => {
    spec.assertTheCanonicalCodeIsTheCandidatesOwn();
  });
  it("P6 leaves an unmatched code as named", () => {
    spec.assertAnUnmatchedCodeIsLeftAsNamed();
  });
});

describe("parentChoiceOpen (F4.243 review #1)", () => {
  it("P7 keeps the step open for a stored inactive parent", () => {
    spec.assertAStoredInactiveParentKeepsTheStepOpen();
  });
  it("P7 keeps the step open for a stored too-deep parent", () => {
    spec.assertAStoredTooDeepParentKeepsTheStepOpen();
  });
  it("P7 keeps the step open for a stored unknown parent", () => {
    spec.assertAStoredUnknownParentKeepsTheStepOpen();
  });
  it("P7 closes the step for a valid stored parent", () => {
    spec.assertAValidStoredParentClosesTheStep();
  });
  it("P7 closes the step for a stored root", () => {
    spec.assertAStoredRootClosesTheStep();
  });
  it("P7 puts the guard sentence first in the re-ask, without echo", () => {
    spec.assertTheReAskPutsTheGuardSentenceFirst();
  });
});

describe("resolveParentTurn refuses what the commit refuses (F4.243 review #3)", () => {
  it("P8 does not match a too-deep code", () => {
    spec.assertATooDeepCodeIsNotMatched();
  });
  it("P8 does not match a too-deep name", () => {
    spec.assertATooDeepNameIsNotMatched();
  });
});
