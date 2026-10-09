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
  is(groupNodeFor(CHAIN, 1, null), "A", "depth 1 on D → C → B → A");
}

/** Depth 2 is the second node from the root, depth 3 the third — the off-by-one pair. */
export function depthTwoAndThreeAreTheSecondAndThirdFromTheRoot(): void {
  is(groupNodeFor(CHAIN, 2, null), "B", "depth 2 on D → C → B → A");
  is(groupNodeFor(CHAIN, 3, null), "C", "depth 3 on D → C → B → A");
}

/** B2: a node at the grouping depth, or shallower than it, groups by itself. */
export function aNodeAtOrAboveTheDepthGroupsByItself(): void {
  is(groupNodeFor(CHAIN, 4, null), "D", "depth 4 on a depth-4 node");
  is(groupNodeFor(CHAIN.slice(2).map((row, i) => ({ ...row, steps: i })), 3, null), "B", "depth 3 on B → A");
}

/** A6: an unreadable target falls to the HIGHEST readable ancestor below it. */
export function anUnreadableTargetFallsToTheHighestReadableAncestor(): void {
  is(groupNodeFor(CHAIN, 1, new Set(["B", "C", "D"])), "B", "depth 1, A unreadable");
  is(groupNodeFor(CHAIN, 1, new Set(["C", "D"])), "C", "depth 1, A and B unreadable");
}

/** A6: nothing readable between the target and the node — the node itself, never the target. */
export function nothingReadableAboveFallsToTheNodeItself(): void {
  is(groupNodeFor(CHAIN, 1, new Set(["D"])), "D", "depth 1, only D readable");
  is(groupNodeFor(CHAIN, 2, new Set<string>()), "D", "depth 2, nothing readable");
}

/** `readable === null` (an unrestricted reader) is the target itself. */
export function anUnrestrictedReaderGetsTheTarget(): void {
  is(groupNodeFor(CHAIN, 1, null), "A", "depth 1, unrestricted");
  is(groupNodeFor(CHAIN, 1, new Set(["A", "D"])), "A", "depth 1, A readable");
}

/** A node with no chain row (deleted under the reader) groups by nothing — the caller falls back. */
export function anEmptyChainHasNoGroup(): void {
  let threw = false;
  try {
    groupNodeFor([], 1, null);
  } catch {
    threw = true;
  }
  assert(threw, "an empty chain names no node, so groupNodeFor must refuse it rather than invent one");
}
