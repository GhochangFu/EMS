import { expect } from "vitest";

import { ancestorIds, interiorNodeIds, locationTreeOptions, subtreeIds } from "./location-tree";

/**
 * `F2.10` (ADR 0098) — the web's view of the location tree. One `export` per
 * claim so the `.test.ts` wrapper holds one `it()` each (ADR 0014).
 */

type Node = { id: string; name: string; parentId: string | null };

function node(id: string, parentId: string | null = null): Node {
  return { id, name: id.toUpperCase(), parentId };
}

/** Root R with child C and grandchild G, then a sibling root S. Input order is the API's name order. */
const TREE: readonly Node[] = [node("g", "c"), node("c", "r"), node("r"), node("s")];

export function depthFirstOrderPutsTheChildRightAfterItsParent(): void {
  expect(locationTreeOptions(TREE)).toEqual([
    { id: "r", name: "R", depth: 0, label: "R" },
    { id: "c", name: "C", depth: 1, label: "— C" },
    { id: "g", name: "G", depth: 2, label: "— — G" },
    { id: "s", name: "S", depth: 0, label: "S" },
  ]);
}

export function siblingsKeepTheInputOrder(): void {
  const nodes = [node("r"), node("b", "r"), node("a", "r")];
  expect(locationTreeOptions(nodes).map((o) => o.id)).toEqual(["r", "b", "a"]);
}

export function aFlatListKeepsTheInputOrderAtDepthZero(): void {
  const nodes = [node("z"), node("a"), node("m")];
  expect(locationTreeOptions(nodes)).toEqual([
    { id: "z", name: "Z", depth: 0, label: "Z" },
    { id: "a", name: "A", depth: 0, label: "A" },
    { id: "m", name: "M", depth: 0, label: "M" },
  ]);
}

export function anOrphanParentIdIsARoot(): void {
  const nodes = [node("a"), node("o", "missing")];
  expect(locationTreeOptions(nodes)).toEqual([
    { id: "a", name: "A", depth: 0, label: "A" },
    { id: "o", name: "O", depth: 0, label: "O" },
  ]);
}

export function aPlantedCycleTerminatesAndListsEachNodeOnce(): void {
  const nodes = [node("a", "b"), node("b", "a")];
  const ids = locationTreeOptions(nodes).map((o) => o.id);
  expect([...ids].sort()).toEqual(["a", "b"]);
}

export function anEmptyListIsEmpty(): void {
  expect(locationTreeOptions([])).toEqual([]);
}

export function nameOfReplacesTheNameInTheLabel(): void {
  const options = locationTreeOptions(TREE, (n) => `${n.id} · ${n.name}`);
  expect(options[1]).toEqual({ id: "c", name: "C", depth: 1, label: "— c · C" });
}

export function subtreeIdsExcludesASiblingSubtree(): void {
  expect([...subtreeIds(TREE, "c")].sort()).toEqual(["c", "g"]);
}

export function ancestorIdsIsNearestFirst(): void {
  expect(ancestorIds(TREE, "g")).toEqual(["c", "r"]);
}

export function ancestorIdsOfARootIsEmpty(): void {
  expect(ancestorIds(TREE, "r")).toEqual([]);
}

export function interiorNodeIdsExcludesLeaves(): void {
  expect([...interiorNodeIds(TREE)].sort()).toEqual(["c", "r"]);
}
