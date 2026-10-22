/**
 * `F4.243` (ADR 0098 Amendment 2, B4–B6) — the placement helpers, without a
 * database: P1 the pending rule, P2 the validate-time problem per guard, P3
 * the guided question, P4 and P5 the reading of a reply.
 */
import { LOCATION_TREE_MAX_DEPTH } from "@bms/shared";

import { MAX_ECHOED_ITEMS } from "../spreadsheet-guard";
import {
  EMPTY_PLACEMENT,
  NO_PARENT_REPLY,
  canonicalParentCode,
  findParentCandidate,
  parentChoiceOpen,
  parentChoicePending,
  parentPlacementProblem,
  parentQuestion,
  resolveParentTurn,
  type ParentCandidate,
  type PlacementContext,
} from "./onboarding-location-parent";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CAMPUS: ParentCandidate = { code: "CAMPUS-1", name: "Thane Campus", active: true, depth: 1 };
const OLD: ParentCandidate = { code: "OLD-SITE", name: "Old Site", active: false, depth: 1 };
const DEEP7: ParentCandidate = { code: "DEEP-7", name: "Level seven", active: true, depth: 7 };
const DEEP8: ParentCandidate = { code: "DEEP-8", name: "Level eight", active: true, depth: 8 };

const PLACEMENT: PlacementContext = { candidates: [CAMPUS, OLD, DEEP7, DEEP8] };

/* P1 — B5: asked while the org has an active location and the key is absent. */

export function assertAbsentKeyWithActiveCandidateIsPending(): void {
  assert(parentChoicePending({}, PLACEMENT), "an absent parentCode with an active candidate must be pending");
}

export function assertNullParentIsNotPending(): void {
  assert(!parentChoicePending({ parentCode: null }, PLACEMENT), "null is a choice (a root) and must not be pending");
}

export function assertCodeParentIsNotPending(): void {
  assert(!parentChoicePending({ parentCode: "CAMPUS-1" }, PLACEMENT), "a named parent must not be pending");
}

export function assertOrgWithoutLocationIsNotAsked(): void {
  assert(!parentChoicePending({}, EMPTY_PLACEMENT), "an org with no location must not be asked");
}

export function assertOrgWithOnlyInactiveLocationIsNotAsked(): void {
  assert(
    !parentChoicePending({}, { candidates: [OLD] }),
    "an org whose only location is inactive must not be asked",
  );
}

export function assertNoLocationIsNotPending(): void {
  assert(!parentChoicePending(undefined, PLACEMENT), "a draft with no location has no parent to choose yet");
}

/* P2 — B4: the guard's sentence per reachable refusal. */

export function assertAbsentParentHasNoProblem(): void {
  assert(parentPlacementProblem(undefined, PLACEMENT) === null, "absent must have no problem");
}

export function assertNullParentHasNoProblem(): void {
  assert(parentPlacementProblem(null, PLACEMENT) === null, "null must have no problem");
}

export function assertUnknownCodeIsNotFound(): void {
  const problem = parentPlacementProblem("NOPE", PLACEMENT);
  // Exact equality also holds §4.3: the sentence carries no part of the code.
  assert(problem === "Parent location not found", `an unknown code must be not found, got ${String(problem)}`);
}

export function assertCodeIsMatchedWithoutCase(): void {
  const problem = parentPlacementProblem("campus-1", PLACEMENT);
  assert(problem === null, `B2: a code in another case names the candidate, got ${String(problem)}`);
}

export function assertInactiveParentIsRefused(): void {
  const problem = parentPlacementProblem("OLD-SITE", PLACEMENT);
  assert(problem === "The parent location is inactive", `an inactive parent must be refused, got ${String(problem)}`);
}

export function assertParentAtDepthSevenPasses(): void {
  assert(LOCATION_TREE_MAX_DEPTH === 8, `the fixture assumes a cap of 8, got ${LOCATION_TREE_MAX_DEPTH}`);
  const problem = parentPlacementProblem("DEEP-7", PLACEMENT);
  assert(problem === null, `a child at depth 8 is inside the cap, got ${String(problem)}`);
}

export function assertParentAtDepthEightIsTooDeep(): void {
  const problem = parentPlacementProblem("DEEP-8", PLACEMENT);
  assert(
    problem === `A location tree may be at most ${LOCATION_TREE_MAX_DEPTH} levels deep`,
    `a child at depth 9 must be refused, got ${String(problem)}`,
  );
}

export function assertActiveRootHasNoProblem(): void {
  assert(parentPlacementProblem("CAMPUS-1", PLACEMENT) === null, "an active root parent must pass");
}

/* P3 — B6: the question and its chips. */

export function assertQuestionNamesTheLocation(): void {
  const { text } = parentQuestion("Thane Pump", PLACEMENT);
  assert(text.startsWith("Which existing location is **Thane Pump** under?"), `unexpected question: ${text}`);
}

export function assertChipsAreActiveCodesThenNoParentThenViewDraft(): void {
  const { replies } = parentQuestion("X", PLACEMENT);
  // Review #3: DEEP-8 is active but too deep to hold a child, so it is no chip.
  const expected = ["CAMPUS-1", "DEEP-7", NO_PARENT_REPLY, "View draft"];
  assert(JSON.stringify(replies) === JSON.stringify(expected), `chips: ${JSON.stringify(replies)}`);
}

const MANY: PlacementContext = {
  candidates: Array.from({ length: MAX_ECHOED_ITEMS + 3 }, (_, i) => ({
    code: `S-${i}`,
    name: `Site ${i}`,
    active: true,
    depth: 1,
  })),
};

export function assertChipsAreCapped(): void {
  const { replies } = parentQuestion("X", MANY);
  assert(replies.length === MAX_ECHOED_ITEMS + 2, `chips must be capped, got ${replies.length}`);
}

export function assertCutChipListIsCounted(): void {
  const { text } = parentQuestion("X", MANY);
  assert(text.includes("…and 3 more locations"), `the cut must be counted: ${text}`);
}

/* P4 — B6: a reply that names a candidate. */

export function assertCodeMatchesWithoutCase(): void {
  const turn = resolveParentTurn("  campus-1. ", PLACEMENT);
  assert(turn.kind === "code" && turn.code === "CAMPUS-1", `code match: ${JSON.stringify(turn)}`);
}

export function assertNameMatchesToTheCode(): void {
  const turn = resolveParentTurn("thane campus", PLACEMENT);
  assert(turn.kind === "code" && turn.code === "CAMPUS-1", `name match: ${JSON.stringify(turn)}`);
}

export function assertInactiveCandidateIsNotMatched(): void {
  const turn = resolveParentTurn("OLD-SITE", PLACEMENT);
  assert(turn.kind === "unmatched", `an inactive candidate must not match: ${JSON.stringify(turn)}`);
}

export function assertAmbiguousNameIsNotMatched(): void {
  const twin: ParentCandidate = { ...DEEP7, code: "TWIN", name: "Thane Campus" };
  const turn = resolveParentTurn("Thane Campus", { candidates: [CAMPUS, twin] });
  assert(turn.kind === "unmatched", `a name two locations share must not match: ${JSON.stringify(turn)}`);
}

/* P5 — B6: the root words, and everything else. */

export function assertNoParentWordsChooseRoot(): void {
  for (const word of [NO_PARENT_REPLY, "none", "Root", "top level"]) {
    const turn = resolveParentTurn(word, PLACEMENT);
    assert(turn.kind === "root", `${word} must choose a root: ${JSON.stringify(turn)}`);
  }
}

export function assertOtherReplyIsUnmatched(): void {
  for (const reply of ["", "somewhere else", "CAMPUS"]) {
    const turn = resolveParentTurn(reply, PLACEMENT);
    assert(turn.kind === "unmatched", `${JSON.stringify(reply)} must be unmatched: ${JSON.stringify(turn)}`);
  }
}

/* P6 — B2 (review #7): the one case rule for a parent code. */

const LOWER: ParentCandidate = { code: "campus-1", name: "Lower", active: true, depth: 1 };

export function assertAnExactCodeWinsOverACaseMatch(): void {
  const found = findParentCandidate("campus-1", [CAMPUS, LOWER]);
  assert(found === LOWER, `the exact code wins, got ${JSON.stringify(found)}`);
}

export function assertAUniqueCaseMatchIsFound(): void {
  const found = findParentCandidate("Campus-1", [CAMPUS, OLD]);
  assert(found === CAMPUS, `the one case-insensitive match is found, got ${JSON.stringify(found)}`);
}

export function assertTwoCaseMatchesAreNoMatch(): void {
  const found = findParentCandidate("Campus-1", [CAMPUS, LOWER]);
  assert(found === undefined, `two case-insensitive matches are no match, got ${JSON.stringify(found)}`);
}

export function assertTheCanonicalCodeIsTheCandidatesOwn(): void {
  const got = canonicalParentCode("campus-1", PLACEMENT);
  assert(got === "CAMPUS-1", `the stored code is the candidate's own, got ${String(got)}`);
}

export function assertAnUnmatchedCodeIsLeftAsNamed(): void {
  const got = canonicalParentCode("NOPE", PLACEMENT);
  assert(got === "NOPE", `an unmatched code is unchanged, got ${String(got)}`);
}

/* P7 — review #1: a stored parent the commit would refuse keeps the step open. */

export function assertAStoredInactiveParentKeepsTheStepOpen(): void {
  assert(parentChoiceOpen({ parentCode: "OLD-SITE" }, PLACEMENT), "an inactive stored parent keeps the step open");
}

export function assertAStoredTooDeepParentKeepsTheStepOpen(): void {
  assert(parentChoiceOpen({ parentCode: "DEEP-8" }, PLACEMENT), "a too-deep stored parent keeps the step open");
}

export function assertAStoredUnknownParentKeepsTheStepOpen(): void {
  assert(parentChoiceOpen({ parentCode: "GONE" }, EMPTY_PLACEMENT), "an unknown stored parent keeps the step open");
}

export function assertAValidStoredParentClosesTheStep(): void {
  assert(!parentChoiceOpen({ parentCode: "CAMPUS-1" }, PLACEMENT), "a valid stored parent closes the step");
}

export function assertAStoredRootClosesTheStep(): void {
  assert(!parentChoiceOpen({ parentCode: null }, PLACEMENT), "a stored root closes the step");
}

export function assertTheReAskPutsTheGuardSentenceFirst(): void {
  const { text } = parentQuestion("Thane Pump", PLACEMENT, "OLD-SITE");
  const expected = "The parent location is inactive. Which existing location is **Thane Pump** under?";
  assert(text.startsWith(expected) && !text.includes("OLD-SITE"), `the guard sentence comes first, unechoed: ${text}`);
}

/* P8 — review #3: a reply cannot choose a parent the commit would refuse. */

export function assertATooDeepCodeIsNotMatched(): void {
  const turn = resolveParentTurn("DEEP-8", PLACEMENT);
  assert(turn.kind === "unmatched", `a parent at depth 8 must not match: ${JSON.stringify(turn)}`);
}

export function assertATooDeepNameIsNotMatched(): void {
  const turn = resolveParentTurn("Level eight", PLACEMENT);
  assert(turn.kind === "unmatched", `a parent at depth 8 must not match by name: ${JSON.stringify(turn)}`);
}
