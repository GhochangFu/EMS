import { describe, it } from "vitest";

import {
  aCapOffTheChainGroupsTheNodeByItself,
  aCappedUnreadableTargetFallsBelowTheCap,
  aNodeAtOrAboveTheDepthGroupsByItself,
  anEmptyChainHasNoGroup,
  anUnreadableTargetFallsToTheHighestReadableAncestor,
  anUnrestrictedReaderGetsTheTarget,
  depthOneIsTheRoot,
  depthTwoAndThreeAreTheSecondAndThirdFromTheRoot,
  nothingReadableAboveFallsToTheNodeItself,
  theDashboardNodeItselfGroupsByItself,
  theGroupNeverGoesAboveTheDashboardNode,
} from "./sustainability-grouping.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.10 groupNodeFor — by_location's groupDepth (ADR 0098 A6, B2, C; no database)", () => {
  it("depth 1 on a four-deep chain is the root", () => {
    depthOneIsTheRoot();
  });

  it("depth 2 and depth 3 are the second and third node from the root", () => {
    depthTwoAndThreeAreTheSecondAndThirdFromTheRoot();
  });

  it("a node at or above the grouping depth groups by itself (B2)", () => {
    aNodeAtOrAboveTheDepthGroupsByItself();
  });

  it("an unreadable target falls to the highest readable ancestor below it (A6)", () => {
    anUnreadableTargetFallsToTheHighestReadableAncestor();
  });

  it("nothing readable above the node falls to the node itself (A6)", () => {
    nothingReadableAboveFallsToTheNodeItself();
  });

  it("an unrestricted reader (null) groups by the target", () => {
    anUnrestrictedReaderGetsTheTarget();
  });

  it("an empty chain is refused, not answered", () => {
    anEmptyChainHasNoGroup();
  });

  it("P1: the group never goes above the dashboard's own node (depth 1, 2, 3 at B)", () => {
    theGroupNeverGoesAboveTheDashboardNode();
  });

  it("P1 with A6: an unreadable capped target falls below the cap", () => {
    aCappedUnreadableTargetFallsBelowTheCap();
  });

  it("P1 with B2: the dashboard's own node groups by itself", () => {
    theDashboardNodeItselfGroupsByItself();
  });

  it("P1: a cap off the node's chain groups the node by itself", () => {
    aCapOffTheChainGroupsTheNodeByItself();
  });
});
