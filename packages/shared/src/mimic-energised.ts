/**
 * `F3.74` / ADR 0088 plan D3, D6 — the energised walk over a mimic's directed pipes, and the
 * worst state among a node's downstream switches.
 *
 * One walk for both mimic arms (Amendment 1, OQ3b): the web builds the graph from either arm's
 * geometry — a preset's `sources`, or the layout units with `isSource` — and a node switches iff
 * its symbol does (`isSwitchingSymbol`). The walk reads member switch states the caller derived
 * with `deriveBreakerState`; it never reads telemetry.
 */

/** A pipe's (and a node's outbound) energy. */
export type Energy = "energised" | "de-energised" | "unknown";

/**
 * One member's switch state, as the walk sees it. A `BreakerState` of `offline` maps to `unknown`
 * here (stale is not knowable); the caller does that mapping.
 */
export type SwitchState = "closed" | "open" | "tripped" | "unknown";

/**
 * One node. `switching` is the symbol rule; `fanOut` says the node stands for several members —
 * the walk treats every switching node's member list the same way, so it is carried for the
 * caller, not read here.
 */
export type EnergyGraphNode = {
  readonly key: string;
  readonly switching: boolean;
  readonly fanOut: boolean;
};

export type EnergyGraph = {
  readonly nodes: readonly EnergyGraphNode[];
  readonly pipes: readonly { readonly from: string; readonly to: string }[];
  readonly sources: readonly string[];
};

/**
 * The walk's answer. `nodes` holds each node's OUTBOUND energy — what it passes on, so an open
 * breaker fed from an energised source is `de-energised` here — and `pipes`, keyed by
 * `mimicPipeKey`, the energy out of each pipe's `from`.
 */
export type EnergisedGraph = {
  readonly nodes: ReadonlyMap<string, Energy>;
  readonly pipes: ReadonlyMap<string, Energy>;
};

/** The `pipes` key of the pipe `from` → `to`. */
export function mimicPipeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** The join order: energised > unknown > de-energised. */
const ENERGY_RANK: Readonly<Record<Energy, number>> = { "de-energised": 0, unknown: 1, energised: 2 };

function lower(a: Energy, b: Energy): Energy {
  return ENERGY_RANK[a] <= ENERGY_RANK[b] ? a : b;
}

function higher(a: Energy, b: Energy): Energy {
  return ENERGY_RANK[a] >= ENERGY_RANK[b] ? a : b;
}

/**
 * What a switching node lets through (OQ4, OR over members): any member `closed` passes energy;
 * otherwise any `unknown` member, or no member at all, is `unknown`; otherwise (every member open
 * or tripped) it stops energy.
 */
function gate(members: readonly SwitchState[] | undefined): Energy {
  if (members === undefined || members.length === 0) {
    return "unknown";
  }
  if (members.some((m) => m === "closed")) {
    return "energised";
  }
  return members.some((m) => m === "unknown") ? "unknown" : "de-energised";
}

/**
 * Walks energy from every source over the pipes; `null` when the graph names no source (no walk:
 * the `F3.32b` freshness dash alone, as before).
 *
 * A source receives energy; a non-source node with no inbound pipe receives none. A node's inbound
 * energy is the OR join of its inbound pipes; a switching node passes `min(inbound, gate)`, every
 * other node passes its inbound energy. A pipe carries the energy out of its `from`.
 *
 * Termination: a joined inbound value only rises, and `visited` records the outbound energy each
 * node last propagated, so a node is walked again only when what it passes on changed — at most
 * three times on the three-level order. A drawn cycle therefore ends.
 */
export function energiseGraph(
  graph: EnergyGraph,
  switchStates: ReadonlyMap<string, readonly SwitchState[]>,
): EnergisedGraph | null {
  if (graph.sources.length === 0) {
    return null;
  }
  const switching = new Set(graph.nodes.filter((n) => n.switching).map((n) => n.key));
  const next = new Map<string, string[]>();
  for (const pipe of graph.pipes) {
    const list = next.get(pipe.from) ?? [];
    list.push(pipe.to);
    next.set(pipe.from, list);
  }

  const inbound = new Map<string, Energy>();
  const outbound = (key: string): Energy => {
    const received = inbound.get(key) ?? "de-energised";
    return switching.has(key) ? lower(received, gate(switchStates.get(key))) : received;
  };

  const visited = new Map<string, Energy>();
  const queue: string[] = [];
  for (const source of graph.sources) {
    inbound.set(source, "energised");
    queue.push(source);
  }
  // Each node's outbound energy only rises through three levels, so a settled walk pops at
  // most sources + 3 × pipes entries. Past that bound the walk has a fault (a lost visited
  // check): throw rather than spin, so a regression reddens a test instead of hanging CI.
  const bound = graph.sources.length + 3 * graph.pipes.length + 1;
  let steps = 0;
  while (queue.length > 0) {
    steps += 1;
    if (steps > bound) {
      throw new Error("energiseGraph: the walk did not settle");
    }
    const key = queue.shift() as string;
    const out = outbound(key);
    if (visited.get(key) === out) {
      continue;
    }
    visited.set(key, out);
    for (const to of next.get(key) ?? []) {
      inbound.set(to, higher(inbound.get(to) ?? "de-energised", out));
      queue.push(to);
    }
  }

  const nodes = new Map<string, Energy>();
  for (const node of graph.nodes) {
    nodes.set(node.key, outbound(node.key));
  }
  const pipes = new Map<string, Energy>();
  for (const pipe of graph.pipes) {
    pipes.set(mimicPipeKey(pipe.from, pipe.to), outbound(pipe.from));
  }
  return { nodes, pipes };
}

/** The frame order of the passive-bus rule (D6): tripped > open > unknown > closed. */
const SWITCH_RANK: Readonly<Record<SwitchState, number>> = { closed: 0, unknown: 1, open: 2, tripped: 3 };

/**
 * The worst member state over the switching nodes directly downstream of `key` (one pipe away), or
 * `null` when there is none — the passive unit then keeps its passive look. A downstream switching
 * node with no members counts as `unknown`, as it does in the walk.
 */
export function worstDownstreamSwitch(
  graph: EnergyGraph,
  key: string,
  states: ReadonlyMap<string, readonly SwitchState[]>,
): SwitchState | null {
  const switching = new Set(graph.nodes.filter((n) => n.switching).map((n) => n.key));
  let worst: SwitchState | null = null;
  for (const pipe of graph.pipes) {
    if (pipe.from !== key || !switching.has(pipe.to)) {
      continue;
    }
    const members = states.get(pipe.to);
    const memberStates: readonly SwitchState[] = members === undefined || members.length === 0 ? ["unknown"] : members;
    for (const state of memberStates) {
      if (worst === null || SWITCH_RANK[state] > SWITCH_RANK[worst]) {
        worst = state;
      }
    }
  }
  return worst;
}
