import { groupNodeFor } from "./sustainability-grouping";

/**
 * `F2.10` U2 — `groupNodeFor`, pure (ADR 0098 decision 7, Amendment 1 A6, B2, C). Assertions
 * live here; `sustainability-grouping.test.ts` is the Vitest entry point (ADR 0014). One
 * exported function per claim.
 *
 * The chain is `D → C → B → A` nearest-first: D is the node at steps 0 and A the root at
 * steps 3, so D sits at depth 4 and the root at depth 1. The off-by-one cases (depth 2 → B,
 * depth 3 → C) live here because the integration fixture is only two levels deep and cannot
 * tell a depth-2 grouping from no grouping.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const CHAIN = [
  { ancestorId: "D", steps: 0 },
  { ancestorId: "C", steps: 1 },
  { ancestorId: "B", steps: 2 },
  { ancestorId: "A", steps: 3 },
] as const;

const is = (actual: string, expected: string, what: string): void =>
  assert(actual === expected, `${what}: expected ${expected}, got ${actual}`);

/** Depth 1 on a four-deep chain is the root. */
export function depthOneIsTheRoot(): void {
  is(groupNodeFor(CHAIN, 1, null, null), "A", "depth 1 on D → C → B → A");
}

/** Depth 2 is the second node from the root, depth 3 the third — the off-by-one pair. */
export function depthTwoAndThreeAreTheSecondAndThirdFromTheRoot(): void {
  is(groupNodeFor(CHAIN, 2, null, null), "B", "depth 2 on D → C → B → A");
  is(groupNodeFor(CHAIN, 3, null, null), "C", "depth 3 on D → C → B → A");
}

/** B2: a node at the grouping depth, or shallower than it, groups by itself. */
export function aNodeAtOrAboveTheDepthGroupsByItself(): void {
  is(groupNodeFor(CHAIN, 4, null, null), "D", "depth 4 on a depth-4 node");
  is(groupNodeFor(CHAIN.slice(2).map((row, i) => ({ ...row, steps: i })), 3, null, null), "B", "depth 3 on B → A");
}

/** A6: an unreadable target falls to the HIGHEST readable ancestor below it. */
export function anUnreadableTargetFallsToTheHighestReadableAncestor(): void {
  is(groupNodeFor(CHAIN, 1, new Set(["B", "C", "D"]), null), "B", "depth 1, A unreadable");
  is(groupNodeFor(CHAIN, 1, new Set(["C", "D"]), null), "C", "depth 1, A and B unreadable");
}

/** A6: nothing readable between the target and the node — the node itself, never the target. */
export function nothingReadableAboveFallsToTheNodeItself(): void {
  is(groupNodeFor(CHAIN, 1, new Set(["D"]), null), "D", "depth 1, only D readable");
  is(groupNodeFor(CHAIN, 2, new Set<string>(), null), "D", "depth 2, nothing readable");
}

/** `readable === null` (an unrestricted reader) is the target itself. */
export function anUnrestrictedReaderGetsTheTarget(): void {
  is(groupNodeFor(CHAIN, 1, null, null), "A", "depth 1, unrestricted");
  is(groupNodeFor(CHAIN, 1, new Set(["A", "D"]), null), "A", "depth 1, A readable");
}

/** A node with no chain row (deleted under the reader) groups by nothing — the caller falls back. */
export function anEmptyChainHasNoGroup(): void {
  let threw = false;
  try {
    groupNodeFor([], 1, null, null);
  } catch {
    threw = true;
  }
  assert(threw, "an empty chain names no node, so groupNodeFor must refuse it rather than invent one");
}

/**
 * Owner ruling P1: on a dashboard at B (depth 2 of D → C → B → A) the group never goes above B.
 * Depth 1 and depth 2 both label B; depth 3 is C, below the cap and untouched by it.
 */
export function theGroupNeverGoesAboveTheDashboardNode(): void {
  is(groupNodeFor(CHAIN, 1, null, "B"), "B", "depth 1 on a dashboard at B");
  is(groupNodeFor(CHAIN, 2, null, "B"), "B", "depth 2 on a dashboard at B");
  is(groupNodeFor(CHAIN, 3, null, "B"), "C", "depth 3 on a dashboard at B");
}

/** P1 with A6: the capped target B unreadable falls to the highest readable node below it, never to A above the cap. */
export function aCappedUnreadableTargetFallsBelowTheCap(): void {
  is(groupNodeFor(CHAIN, 1, new Set(["A", "C", "D"]), "B"), "C", "depth 1 at B, B unreadable, A readable above the cap");
}

/** P1 with B2: the dashboard's own node, or a node shallower than the depth, groups by itself. */
export function theDashboardNodeItselfGroupsByItself(): void {
  const atB = CHAIN.slice(2).map((row, i) => ({ ...row, steps: i }));
  is(groupNodeFor(atB, 1, null, "B"), "B", "B's own chain at depth 1 on a dashboard at B");
  is(groupNodeFor(atB, 3, null, "B"), "B", "B's own chain at depth 3 on a dashboard at B");
}

/** P1 fails closed: a cap that is not on the node's chain groups the node by itself. */
export function aCapOffTheChainGroupsTheNodeByItself(): void {
  is(groupNodeFor(CHAIN, 1, null, "X"), "D", "depth 1, cap X not on D → C → B → A");
}
