import type { CalcCrossRef, CalcDialect } from "@bms/shared";
import { CALC_DIALECTS, crossRefKey, parseFormula } from "@bms/shared";

import { defKey, inputKey } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";

/**
 * The dependency graph over derived points and its evaluation order
 * (ADR 0055 decisions 7 and 8; `F2.9` Task 10).
 *
 * **Pure, and the one graph builder.** ADR 0055 decision 8: "the two detectors
 * must not be two implementations" — the template save path
 * (`templateCycles`) and the scheduled sweep both come through `buildCalcGraph`
 * and `topologicalOrder`, with only the membership they hand in differing.
 * Nothing here touches the database, the clock, NestJS, or the metrics.
 *
 * Every map key below is a `string` at runtime. The three aliases exist so a
 * call site can say which string it holds — `assetCode` (the human code a
 * `{CODE.key}` names) and `assetId` (the uuid) are the pair that must never be
 * confused, since the qualified map goes from one to the other.
 */

/** A `bms.assets.id` — the uuid. Never the human code. */
export type AssetId = string;
/** A `bms.assets.code` — the human code a `{CODE.key}` reference names. */
export type AssetCode = string;
/** The output of `crossRefKey()` for one cross-asset node. Never hand-written. */
export type CrossRefKey = string;
/** `inputKey(assetId, pointKey)` — the node id, one per derived point per asset. */
export type NodeId = string;

/**
 * The fields a definition contributes to the graph. A `CalcDefinition`
 * satisfies this structurally; `templateCycles` synthesises one per template
 * point, which is why the graph does not take the full definition.
 */
export type GraphDefinition = Pick<CalcDefinition, "assetId" | "pointKey" | "templatePointId" | "refs" | "crossRefs">;

export type GraphNode = {
  /** `inputKey(assetId, pointKey)`. */
  readonly id: NodeId;
  /** `defKey(assetId, templatePointId)` — what the scheduler tracks by. */
  readonly defKey: string;
  readonly assetId: AssetId;
  readonly pointKey: string;
  readonly crossRefs: readonly CalcCrossRef[];
  /** The formula's local `{ref}`s — `CalcDefinition.refs`. */
  readonly localRefs: readonly string[];
};

/**
 * What the host resolved for this tick (`CalcScopeService`, Task 11), keyed
 * by the **owning** asset — the one whose formula holds the reference — because
 * a qualified code and a scope are both resolved against the owner's location
 * (ADR 0055 decision 12).
 *
 * - `qualified`: per owner, each `assetCode` a `{CODE.key}` names → the asset
 *   id at the owner's location, or `null` when no such asset exists there.
 * - `members`: per owner, each aggregate's `crossRefKey` → the `(assetId,
 *   pointKey)` pairs in scope that declare the key. **The owner is in its own
 *   member set when it declares the key** — that is how a site sum that reads
 *   its own output is a one-edge cycle rather than an invisible one.
 */
export type Membership = {
  readonly qualified: ReadonlyMap<AssetId, ReadonlyMap<AssetCode, AssetId | null>>;
  readonly members: ReadonlyMap<AssetId, ReadonlyMap<CrossRefKey, readonly { assetId: AssetId; pointKey: string }[]>>;
};

/**
 * `nodes` keeps the input order of `defs` — every iteration in this module
 * walks it, never a `Map` or `Set` built ad hoc, so the order the sweep sees
 * is a function of its input and nothing else.
 *
 * **Edge direction:** `dependsOn.get(x)` holds every node `x` reads — every
 * node `x` must be computed **after**. The arrow goes from the reader to the
 * read, so a self-loop is `dependsOn.get(x).has(x)`.
 */
export type CalcGraph = {
  readonly nodes: readonly GraphNode[];
  readonly nodeById: ReadonlyMap<NodeId, GraphNode>;
  readonly dependsOn: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
};

/**
 * Builds the graph for one set of definitions under one resolved membership.
 * An edge is added only when both ends are derived nodes in `defs` — a
 * measured point, a code that did not resolve, and a member whose point is
 * not derived all contribute nothing, because none of them is computed by
 * this engine and so none can take part in a cycle.
 *
 * - a local `{ref}` → the same asset's node for that key, if one exists;
 * - a `{CODE.key}` → `membership.qualified` resolves `CODE` for the owner; an
 *   absent or `null` resolution adds **no edge**, so a dangling code is a
 *   `missing_input` at evaluation time, never a cycle;
 * - an aggregate → every pair under its `crossRefKey` in `membership.members`,
 *   **the owner's own pair included** when the host put it there.
 *
 * One node per `(assetId, pointKey)`: a later definition with the same id is
 * dropped, not merged, so the caller's invariant (one derived row per asset
 * per key) is the only thing that makes `nodes` and `dependsOn` agree.
 */
export function buildCalcGraph(defs: readonly GraphDefinition[], membership: Membership): CalcGraph {
  const nodes: GraphNode[] = [];
  const nodeById = new Map<NodeId, GraphNode>();
  for (const def of defs) {
    const id = inputKey(def.assetId, def.pointKey);
    if (nodeById.has(id)) continue;
    const node: GraphNode = {
      id,
      defKey: defKey(def.assetId, def.templatePointId),
      assetId: def.assetId,
      pointKey: def.pointKey,
      crossRefs: def.crossRefs,
      localRefs: def.refs,
    };
    nodes.push(node);
    nodeById.set(id, node);
  }

  const dependsOn = new Map<NodeId, ReadonlySet<NodeId>>();
  for (const node of nodes) {
    const deps = new Set<NodeId>();
    const addIfDerived = (assetId: AssetId, pointKey: string): void => {
      const target = inputKey(assetId, pointKey);
      if (nodeById.has(target)) deps.add(target);
    };
    for (const ref of node.localRefs) {
      addIfDerived(node.assetId, ref);
    }
    const qualified = membership.qualified.get(node.assetId);
    const members = membership.members.get(node.assetId);
    for (const ref of node.crossRefs) {
      if (ref.kind === "qref") {
        const resolved = qualified?.get(ref.assetCode);
        if (resolved === null || resolved === undefined) continue;
        addIfDerived(resolved, ref.pointKey);
      } else {
        for (const pair of members?.get(crossRefKey(ref)) ?? []) {
          addIfDerived(pair.assetId, pair.pointKey);
        }
      }
    }
    dependsOn.set(node.id, deps);
  }
  return { nodes, nodeById, dependsOn };
}

export type TopologicalOrder = {
  /** Every non-cyclic node, each after everything it reads that is also here. */
  readonly order: readonly NodeId[];
  /** Every node that lies on a cycle. */
  readonly cyclic: ReadonlySet<NodeId>;
};

/**
 * The evaluation order, and the set the sweep refuses as `dependency_cycle`.
 *
 * **What `cyclic` contains: exactly the nodes that lie on a cycle** — a node
 * that can reach itself along `dependsOn`, of which a self-loop is the
 * one-edge case. It does **not** contain a node that merely *reads* a cycle
 * member, and it does not contain a node a cycle member reads. Both of those
 * are in `order`. That is plan design decision 7 and the owner's Q6 ruling:
 * only cycle members are refused; a formula downstream of a cycle evaluates
 * against the member's stored value, and ADR 0055 decision 5's staleness rule
 * refuses it honestly once that value ages out. A node between two cycles
 * (reads one, is read by the other) lies on neither and is in `order` too.
 *
 * `order` is Kahn's algorithm over the non-cyclic nodes, where an edge into a
 * cyclic node counts as already satisfied — the reader takes the stored value.
 * Once the cyclic nodes are set aside no cycle remains, so every other node
 * reaches in-degree 0; a node that somehow did not would be folded into
 * `cyclic` rather than dropped, so the union of the two results is always
 * every node in the graph.
 *
 * **Deterministic.** Nodes are seeded and their dependents appended in
 * `graph.nodes` order, which is the order of the `defs` handed to
 * `buildCalcGraph`. Two calls over the same definitions in the same order give
 * the same `order`, whatever insertion order the `Membership` maps had.
 *
 * **Cost, stated because this runs every sweep.** The cycle pre-pass walks the
 * graph once per node, so it is `O(N·(N+E))` where `N` is the number of derived
 * points across the estate — against 35 derived rows today, and against a
 * graph that is nearly all isolated `v1` nodes with no edges at all, that is
 * nothing. It is written for clarity rather than for scale on purpose: ADR 0037
 * decision 7 refused a per-tick cap because computing a silent subset is worse
 * than being slow, and the same trade applies here. If `N` ever reaches the
 * thousands, replace the pre-pass with Tarjan's SCC — one linear pass giving
 * the same set — and keep every test in `calc-graph.spec.ts` unchanged, which
 * is what makes that swap safe to make later rather than now.
 */
export function topologicalOrder(graph: CalcGraph): TopologicalOrder {
  const cyclic = new Set<NodeId>();
  for (const node of graph.nodes) {
    if (reachableFrom(node.id, graph.dependsOn).has(node.id)) {
      cyclic.add(node.id);
    }
  }

  const inDegree = new Map<NodeId, number>();
  const dependents = new Map<NodeId, NodeId[]>();
  for (const node of graph.nodes) {
    if (cyclic.has(node.id)) continue;
    dependents.set(node.id, []);
  }
  for (const node of graph.nodes) {
    if (cyclic.has(node.id)) continue;
    let degree = 0;
    for (const dep of graph.dependsOn.get(node.id) ?? []) {
      if (cyclic.has(dep)) continue;
      degree += 1;
      dependents.get(dep)?.push(node.id);
    }
    inDegree.set(node.id, degree);
  }

  const order: NodeId[] = [];
  const queue: NodeId[] = graph.nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  for (const [id, remaining] of inDegree) {
    if (remaining > 0) cyclic.add(id);
  }
  return { order, cyclic };
}

/** Every node reachable from `start` along one or more `dependsOn` edges. */
function reachableFrom(start: NodeId, dependsOn: ReadonlyMap<NodeId, ReadonlySet<NodeId>>): Set<NodeId> {
  const seen = new Set<NodeId>();
  const stack: NodeId[] = [...(dependsOn.get(start) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as NodeId;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of dependsOn.get(id) ?? []) {
      if (!seen.has(dep)) stack.push(dep);
    }
  }
  return seen;
}

/** The one virtual asset every template point is placed on for a save-time check. */
export const TEMPLATE_VIRTUAL_ASSET_ID: AssetId = "@template";

/** The template-point fields the save path hands in — the stored row's shape,
 * not a parsed definition, so a point that fails to parse is skipped here. */
export type TemplateCyclePoint = {
  pointKey: string;
  kind: string;
  formula: string | null;
  formulaDialect: string | null;
};

/** One cyclic point, with the point keys of the cycle it lies on (itself included). */
export type TemplateCycle = { pointKey: string; members: string[] };

/**
 * The save-time detector for one template's points (ADR 0055 decision 8): the
 * same builder and sort as the sweep, over a virtual asset `"@template"` whose
 * membership is the template's own declared point keys.
 *
 * **What this cannot see, and why the tick is the authority.** A template has
 * no location. At save time `@site` resolves to the template's own declared
 * keys and nothing else — no sibling asset, so no cross-asset edge; `@domain`
 * and `@group` resolve to nothing at all, because no template is in a domain
 * or a group; and every `{CODE.key}` resolves to `null`, because a template
 * has no assets. This function therefore proves only that the template's own
 * points do not form a cycle **among themselves** through local references
 * and `@site` aggregates over their own keys. A cycle that exists only once
 * the template is instantiated beside other assets — or one that appears when
 * an asset later joins a site or a group — is found by the sweep's detector,
 * which resolves the membership as it actually is (decision 8).
 *
 * A point that is not derived, has no formula, carries a dialect this engine
 * does not know, or does not parse is skipped: the save path already refuses
 * each of those with its own message, and reporting one a second time as a
 * cycle would be wrong.
 */
export function templateCycles(points: readonly TemplateCyclePoint[]): TemplateCycle[] {
  const defs: GraphDefinition[] = [];
  for (const point of points) {
    if (point.kind !== "derived" || !point.formula) continue;
    const dialect: CalcDialect | undefined = CALC_DIALECTS.find((known) => known === point.formulaDialect);
    if (!dialect) continue;
    const parsed = parseFormula(point.formula, { dialect });
    if (!parsed.ok) continue;
    defs.push({
      assetId: TEMPLATE_VIRTUAL_ASSET_ID,
      pointKey: point.pointKey,
      templatePointId: point.pointKey,
      refs: parsed.refs,
      crossRefs: parsed.crossRefs,
    });
  }

  const declared = new Set(points.map((point) => point.pointKey));
  const siteMembers = new Map<CrossRefKey, readonly { assetId: AssetId; pointKey: string }[]>();
  for (const def of defs) {
    for (const ref of def.crossRefs) {
      if (ref.kind !== "aggregate" || ref.scope.kind !== "site") continue;
      siteMembers.set(
        crossRefKey(ref),
        declared.has(ref.pointKey) ? [{ assetId: TEMPLATE_VIRTUAL_ASSET_ID, pointKey: ref.pointKey }] : [],
      );
    }
  }
  const membership: Membership = {
    qualified: new Map(),
    members: new Map([[TEMPLATE_VIRTUAL_ASSET_ID, siteMembers]]),
  };

  const graph = buildCalcGraph(defs, membership);
  const { cyclic } = topologicalOrder(graph);
  const cycles: TemplateCycle[] = [];
  for (const node of graph.nodes) {
    if (!cyclic.has(node.id)) continue;
    const downstream = reachableFrom(node.id, graph.dependsOn);
    const members = graph.nodes
      .filter((other) => cyclic.has(other.id) && downstream.has(other.id) && reachableFrom(other.id, graph.dependsOn).has(node.id))
      .map((other) => other.pointKey);
    cycles.push({ pointKey: node.pointKey, members });
  }
  return cycles;
}
