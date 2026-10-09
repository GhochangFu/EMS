import { describe, it } from "vitest";

import {
  aNodeAtOrAboveTheDepthGroupsByItself,
  anEmptyChainHasNoGroup,
  anUnreadableTargetFallsToTheHighestReadableAncestor,
  anUnrestrictedReaderGetsTheTarget,
  depthOneIsTheRoot,
  depthTwoAndThreeAreTheSecondAndThirdFromTheRoot,
  nothingReadableAboveFallsToTheNodeItself,
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
});
