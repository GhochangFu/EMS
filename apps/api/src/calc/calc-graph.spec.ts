import type { CalcAggregate, CalcCrossRef, CalcDialect } from "@bms/shared";
import { CALC_DIALECT, CALC_DIALECT_V2, crossRefKey, parseFormula } from "@bms/shared";

import { inputKey } from "./calc-batch";
import {
  buildCalcGraph,
  TEMPLATE_VIRTUAL_ASSET_ID,
  templateCycles,
  topologicalOrder,
  type AssetCode,
  type AssetId,
  type CalcGraph,
  type CrossRefKey,
  type GraphDefinition,
  type Membership,
} from "./calc-graph";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * A graph definition built by parsing a real formula, so `refs` and
 * `crossRefs` are what the parser produces and never hand-written — plan
 * finding 49: every cross-reference key in this spec comes from `crossRefKey`
 * over a parsed node.
 */
function def(assetId: AssetId, pointKey: string, formula: string, dialect: CalcDialect = CALC_DIALECT_V2): GraphDefinition {
  const parsed = parseFormula(formula, { dialect });
  if (!parsed.ok) {
    throw new Error(`fixture formula must parse: ${formula} → ${parsed.errors[0]?.code}`);
  }
  return { assetId, pointKey, templatePointId: `tp-${pointKey}`, refs: parsed.refs, crossRefs: parsed.crossRefs };
}

/** The one aggregate node a fixture formula carries — the key source for `members`. */
function aggregateOf(definition: GraphDefinition): CalcAggregate {
  const node: CalcCrossRef | undefined = definition.crossRefs.find((ref) => ref.kind === "aggregate");
  if (!node || node.kind !== "aggregate") {
    throw new Error(`fixture ${definition.pointKey} must carry an aggregate`);
  }
  return node;
}

type Pair = { assetId: AssetId; pointKey: string };

function membership(
  qualified: readonly (readonly [AssetId, readonly (readonly [AssetCode, AssetId | null])[]])[] = [],
  members: readonly (readonly [AssetId, readonly (readonly [CrossRefKey, readonly Pair[]])[]])[] = [],
): Membership {
  return {
    qualified: new Map(qualified.map(([owner, codes]) => [owner, new Map(codes)])),
    members: new Map(members.map(([owner, keys]) => [owner, new Map(keys)])),
  };
}

const NONE = membership();

function depsOf(graph: CalcGraph, id: string): ReadonlySet<string> {
  const deps = graph.dependsOn.get(id);
  assert(deps !== undefined, `node ${id} must be in the graph`);
  return deps ?? new Set();
}

/** Every node appears after every dependency the order also contains. */
function assertRespectsEdges(graph: CalcGraph, order: readonly string[]): void {
  const position = new Map(order.map((id, index) => [id, index]));
  for (const [id, deps] of graph.dependsOn) {
    const own = position.get(id);
    if (own === undefined) continue;
    for (const dep of deps) {
      const theirs = position.get(dep);
      if (theirs !== undefined) {
        assert(theirs < own, `${id} must come after ${dep} in the order`);
      }
    }
  }
}

export function runBuildCalcGraphTests(): void {
  // ---- a local ref edges only to a derived node on the same asset ------------

  const localGraph = buildCalcGraph(
    [def("X", "A", "{m} * 2", CALC_DIALECT), def("X", "B", "{A} + {m}"), def("Y", "B", "{A}")],
    NONE,
  );
  const xa = inputKey("X", "A");
  const xb = inputKey("X", "B");
  const yb = inputKey("Y", "B");
  assert(localGraph.nodes.length === 3, `expected 3 nodes, got ${localGraph.nodes.length}`);
  assert(depsOf(localGraph, xa).size === 0, "a formula over measured keys only has no edges");
  assert(depsOf(localGraph, xb).has(xa), "X.B reads X.A, so X.B depends on X.A");
  assert(!depsOf(localGraph, xb).has(inputKey("X", "m")), "a measured key is not a node and adds no edge");
  assert(depsOf(localGraph, yb).size === 0, "Y.B's {A} is Y's A, which is not derived — never X's A");
  assert(localGraph.nodeById.get(xb)?.defKey === "X|tp-B", "defKey pins the node to its template point");
  assert(localGraph.nodeById.get(xb)?.localRefs.includes("A") === true, "localRefs carries the parsed refs");

  // ---- a qref edges to the resolved (assetId, pointKey) when it is derived ----

  const ratio = def("X", "ratio", "{TX_01.kwh} / 2");
  const resolved = buildCalcGraph(
    [ratio, def("Y", "kwh", "{raw} * 1")],
    membership([["X", [["TX_01", "Y"]]]]),
  );
  assert(depsOf(resolved, inputKey("X", "ratio")).has(inputKey("Y", "kwh")), "a resolved qref to a derived point is an edge");

  // ---- an unresolved code (null, or absent) adds no edge -----------------------

  const unresolvedNull = buildCalcGraph(
    [ratio, def("Y", "kwh", "{raw} * 1")],
    membership([["X", [["TX_01", null]]]]),
  );
  assert(depsOf(unresolvedNull, inputKey("X", "ratio")).size === 0, "a code resolved to null adds no edge");
  const unresolvedAbsent = buildCalcGraph([ratio, def("Y", "kwh", "{raw} * 1")], NONE);
  assert(depsOf(unresolvedAbsent, inputKey("X", "ratio")).size === 0, "a code with no resolution entry adds no edge");

  // ---- a resolved qref to a measured point adds no edge -------------------------

  const measuredTarget = buildCalcGraph([ratio], membership([["X", [["TX_01", "Y"]]]]));
  assert(depsOf(measuredTarget, inputKey("X", "ratio")).size === 0, "a qref to a non-derived point is not an edge");

  // ---- an aggregate edges to every derived member, the owner included ---------

  const siteSum = def("X", "site_kw", "sum({kw} @site)");
  const key = crossRefKey(aggregateOf(siteSum));
  const aggregated = buildCalcGraph(
    [siteSum, def("X", "kw", "{raw}"), def("Y", "kw", "{raw}")],
    membership([], [["X", [[key, [{ assetId: "X", pointKey: "kw" }, { assetId: "Y", pointKey: "kw" }, { assetId: "Z", pointKey: "kw" }]]]]]),
  );
  const siteDeps = depsOf(aggregated, inputKey("X", "site_kw"));
  assert(siteDeps.has(inputKey("X", "kw")), "the owner's own derived kw is a member edge");
  assert(siteDeps.has(inputKey("Y", "kw")), "another asset's derived kw is a member edge");
  assert(!siteDeps.has(inputKey("Z", "kw")), "a member whose point is not derived is not a node, so no edge");
  assert(siteDeps.size === 2, `expected exactly 2 aggregate edges, got ${siteDeps.size}`);

  // ---- a duplicate (assetId, pointKey) keeps the first node ---------------------

  const duplicated = buildCalcGraph([def("X", "A", "{m}"), def("X", "A", "{n}")], NONE);
  assert(duplicated.nodes.length === 1, "one node per (assetId, pointKey)");
}

export function runTopologicalOrderTests(): void {
  // ---- A → B → C orders A, B, C ------------------------------------------------

  const chain = buildCalcGraph(
    [def("X", "C", "{B}"), def("X", "A", "{m} * 2", CALC_DIALECT), def("X", "B", "{A}")],
    NONE,
  );
  const chainOrder = topologicalOrder(chain);
  assert(
    chainOrder.order.join(",") === [inputKey("X", "A"), inputKey("X", "B"), inputKey("X", "C")].join(","),
    `A→B→C must order A,B,C, got ${chainOrder.order.join(",")}`,
  );
  assert(chainOrder.cyclic.size === 0, "a chain has no cyclic node");

  // ---- A → B → A: both cyclic, order empty -------------------------------------

  const pair = buildCalcGraph([def("X", "A", "{B}"), def("X", "B", "{A}")], NONE);
  const pairOrder = topologicalOrder(pair);
  assert(pairOrder.order.length === 0, `a two-cycle orders nothing, got ${pairOrder.order.join(",")}`);
  assert(pairOrder.cyclic.has(inputKey("X", "A")) && pairOrder.cyclic.has(inputKey("X", "B")), "both members are cyclic");

  // ---- A → B → A with an unrelated C: C is in order ----------------------------

  const withC = buildCalcGraph([def("X", "A", "{B}"), def("X", "B", "{A}"), def("X", "C", "{m}")], NONE);
  const withCOrder = topologicalOrder(withC);
  assert(withCOrder.order.join(",") === inputKey("X", "C"), "an unrelated node is ordered beside a cycle");
  assert(withCOrder.cyclic.size === 2 && !withCOrder.cyclic.has(inputKey("X", "C")), "the unrelated node is not cyclic");

  // ---- a self-loop through an aggregate whose members include the owner -------

  const selfSum = def("X", "total_kw", "sum({total_kw} @site)");
  const selfKey = crossRefKey(aggregateOf(selfSum));
  const selfLoop = buildCalcGraph(
    [selfSum],
    membership([], [["X", [[selfKey, [{ assetId: "X", pointKey: "total_kw" }]]]]]),
  );
  const selfOrder = topologicalOrder(selfLoop);
  assert(selfOrder.cyclic.has(inputKey("X", "total_kw")), "a site sum that includes its own output is a cycle");
  assert(selfOrder.order.length === 0, "the self-feeding node is not ordered");

  // ---- v1 nodes carry no edges and sort first ----------------------------------

  const mixed = buildCalcGraph(
    [def("X", "B", "{A}"), def("X", "A", "{m}", CALC_DIALECT), def("Y", "V", "{n} * 3", CALC_DIALECT)],
    NONE,
  );
  assert(depsOf(mixed, inputKey("X", "A")).size === 0 && depsOf(mixed, inputKey("Y", "V")).size === 0, "v1 nodes have no edges");
  const mixedOrder = topologicalOrder(mixed).order;
  assert(
    mixedOrder.join(",") === [inputKey("X", "A"), inputKey("Y", "V"), inputKey("X", "B")].join(","),
    `v1 nodes must sort first, got ${mixedOrder.join(",")}`,
  );

  // ---- a node the cycle reads, fed only from outside it, is in order -----------
  // A ↔ B is the cycle; A also reads U, and U reads nothing derived.

  const upstream = buildCalcGraph([def("X", "A", "{B} + {U}"), def("X", "B", "{A}"), def("X", "U", "{m}")], NONE);
  const upstreamOrder = topologicalOrder(upstream);
  assert(upstreamOrder.order.join(",") === inputKey("X", "U"), "a source the cycle reads is ordered, not cyclic");
  assert(!upstreamOrder.cyclic.has(inputKey("X", "U")), "feeding a cycle does not make a node cyclic");

  // ---- a node that reads a cycle member is in order, not cyclic ----------------
  // Plan design decision 7 / ruling Q6: only cycle members are refused; a
  // formula downstream of a cycle evaluates against the stored value.

  const downstream = buildCalcGraph(
    [def("X", "D", "{A} * 2"), def("X", "A", "{B}"), def("X", "B", "{A}"), def("X", "E", "{D}")],
    NONE,
  );
  const downstreamOrder = topologicalOrder(downstream);
  assert(
    downstreamOrder.order.join(",") === [inputKey("X", "D"), inputKey("X", "E")].join(","),
    `downstream nodes are ordered after each other, got ${downstreamOrder.order.join(",")}`,
  );
  assert(downstreamOrder.cyclic.size === 2, "only the two cycle members are cyclic");

  // ---- a node between two cycles is on neither, so it is in order --------------

  const sandwiched = buildCalcGraph(
    [def("X", "A", "{B}"), def("X", "B", "{A}"), def("X", "M", "{A}"), def("X", "C", "{M} + {D}"), def("X", "D", "{C}")],
    NONE,
  );
  const sandwichedOrder = topologicalOrder(sandwiched);
  assert(sandwichedOrder.order.join(",") === inputKey("X", "M"), "the node between two cycles is ordered");
  assert(sandwichedOrder.cyclic.size === 4, `both cycles' members are cyclic, got ${sandwichedOrder.cyclic.size}`);

  // ---- determinism: the same defs under differently-ordered Maps ---------------

  const ySum = def("Y", "site_kw", "sum({kw} @site)");
  const zRatio = def("Z", "ratio", "{X_CODE.kw} / {Y_CODE.site_kw}");
  const defs = [ySum, def("X", "kw", "{raw}"), zRatio, def("Z", "kw", "{raw}"), def("Y", "kw", "{raw}")];
  const sumKey = crossRefKey(aggregateOf(ySum));
  const forward = membership(
    [["Z", [["X_CODE", "X"], ["Y_CODE", "Y"]]], ["Y", [["X_CODE", "X"]]]],
    [["Y", [[sumKey, [{ assetId: "X", pointKey: "kw" }, { assetId: "Y", pointKey: "kw" }, { assetId: "Z", pointKey: "kw" }]]]]],
  );
  const backward = membership(
    [["Y", [["X_CODE", "X"]]], ["Z", [["Y_CODE", "Y"], ["X_CODE", "X"]]]],
    [["Y", [[sumKey, [{ assetId: "Z", pointKey: "kw" }, { assetId: "Y", pointKey: "kw" }, { assetId: "X", pointKey: "kw" }]]]]],
  );
  const first = topologicalOrder(buildCalcGraph(defs, forward));
  const second = topologicalOrder(buildCalcGraph(defs, backward));
  assert(first.order.length === defs.length, `every node is ordered, got ${first.order.length}`);
  assert(first.order.join(",") === second.order.join(","), `order must not depend on Map insertion order:\n${first.order.join(",")}\n${second.order.join(",")}`);
  assert(first.cyclic.size === 0 && second.cyclic.size === 0, "the determinism fixture is acyclic");
  assertRespectsEdges(buildCalcGraph(defs, forward), first.order);
}

export function runTemplateCyclesTests(): void {
  const point = (pointKey: string, formula: string | null, formulaDialect: string | null = CALC_DIALECT_V2, kind = "derived") => ({
    pointKey,
    kind,
    formula,
    formulaDialect,
  });

  // ---- D ↔ E under v2: both reported, each naming the pair ----------------------

  const mutual = templateCycles([point("D", "{E}"), point("E", "{D}"), point("m", null, null, "measured")]);
  assert(
    mutual.map((c) => c.pointKey).join(",") === "D,E",
    `both members of D↔E must be reported, got ${mutual.map((c) => c.pointKey).join(",")}`,
  );
  assert(mutual[0]?.members.join(",") === "D,E" && mutual[1]?.members.join(",") === "D,E", "members name the whole cycle");

  // ---- T = sum({T} @site): the template's own key is a member, so self --------

  const self = templateCycles([point("T", "sum({T} @site)")]);
  assert(self.length === 1 && self[0]?.pointKey === "T", "a site sum over the point's own key is a self-cycle");
  assert(self[0]?.members.join(",") === "T", "a self-cycle's members are the point alone");

  // ---- an @site sum over a key the template does not declare is no edge -------

  assert(templateCycles([point("T", "sum({other} @site)")]).length === 0, "an undeclared key has no member at save time");

  // ---- D v1 "{A}": nothing to report ------------------------------------------

  assert(templateCycles([point("D", "{A}", CALC_DIALECT)]).length === 0, "a v1 point over a foreign key is not a cycle");

  // ---- skipped points: not derived, no formula, unparseable, unknown dialect --

  const skipped = templateCycles([
    point("D", "{E}"),
    point("E", "{D}", CALC_DIALECT_V2, "measured"),
    point("F", null),
    point("G", "{D} +", CALC_DIALECT_V2),
    point("H", "{D}", "bms-calc-v9"),
  ]);
  assert(skipped.length === 0, `a point the save path refuses on its own is never reported as a cycle, got ${skipped.length}`);

  // ---- a qref never resolves at save time -------------------------------------

  const qualified = templateCycles([point("D", "{SELF_CODE.E}"), point("E", "{D}")]);
  assert(qualified.length === 0, "a template has no assets, so a qref adds no edge");

  // ---- the virtual asset id is what the adapter reports against ---------------

  assert(TEMPLATE_VIRTUAL_ASSET_ID === "@template", "the virtual asset id is the plan's literal");
}
