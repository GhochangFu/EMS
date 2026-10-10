import { describe, it } from "vitest";

import {
  aFlatListKeepsTheInputOrderAtDepthZero,
  aPlantedCycleTerminatesAndListsEachNodeOnce,
  ancestorIdsIsNearestFirst,
  ancestorIdsOfARootIsEmpty,
  anEmptyListIsEmpty,
  anOrphanParentIdIsARoot,
  depthFirstOrderPutsTheChildRightAfterItsParent,
  interiorNodeIdsExcludesLeaves,
  nameOfReplacesTheNameInTheLabel,
  siblingsKeepTheInputOrder,
  subtreeIdsExcludesASiblingSubtree,
} from "./location-tree.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.10 location-tree", () => {
  it("lists the tree depth-first, the child right after its parent (L1)", () => {
    depthFirstOrderPutsTheChildRightAfterItsParent();
  });

  it("keeps siblings in the input order (L1)", () => {
    siblingsKeepTheInputOrder();
  });

  it("keeps a flat list in the input order at depth 0 (L2)", () => {
    aFlatListKeepsTheInputOrderAtDepthZero();
  });

  it("treats a parentId not in the list as a root (L3)", () => {
    anOrphanParentIdIsARoot();
  });

  it("terminates a planted cycle and lists each node once (L4)", () => {
    aPlantedCycleTerminatesAndListsEachNodeOnce();
  });

  it("returns [] for []", () => {
    anEmptyListIsEmpty();
  });

  it("builds the label from nameOf when given (T9)", () => {
    nameOfReplacesTheNameInTheLabel();
  });

  it("keeps a sibling subtree out of subtreeIds (L5)", () => {
    subtreeIdsExcludesASiblingSubtree();
  });

  it("lists ancestors nearest-first (L6)", () => {
    ancestorIdsIsNearestFirst();
  });

  it("gives a root no ancestor (L6)", () => {
    ancestorIdsOfARootIsEmpty();
  });

  it("keeps leaves out of interiorNodeIds (L7)", () => {
    interiorNodeIdsExcludesLeaves();
  });
});
