import {
  energiseGraph,
  mimicPipeKey,
  worstDownstreamSwitch,
  type Energy,
  type EnergyGraph,
  type SwitchState,
} from "./mimic-energised";

/**
 * `F3.74` / ADR 0088 plan D3 — `energiseGraph` and `worstDownstreamSwitch`.
 *
 * Assertions live here; `mimic-energised.test.ts` is the vitest entry point (ADR 0014). One claim
 * per exported function, so a mutation reddens the `it` that owns it.
 *
 * **Pipe order is deliberate.** Where two paths join, the path that must NOT decide the answer is
 * listed first, so a walk that lets the first arrival settle a node (a visit-once set, or an AND
 * join) answers wrongly and reddens.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** source → breaker → bus → load, the plan's four-node graph. */
const CHAIN: EnergyGraph = {
  nodes: [
    { key: "source", switching: false, fanOut: false },
    { key: "breaker", switching: true, fanOut: false },
    { key: "bus", switching: false, fanOut: false },
    { key: "load", switching: false, fanOut: false },
  ],
  pipes: [
    { from: "source", to: "breaker" },
    { from: "breaker", to: "bus" },
    { from: "bus", to: "load" },
  ],
  sources: ["source"],
};

/**
 * Two breakers into one bus; `b1`'s pipes come first, and `b2` reaches the bus through one more
 * node (`cable`), so the bus is walked from `b1` before `b2`'s energy arrives. A walk that settles
 * a node on its first arrival keeps `b1`'s answer and reddens the OR claims.
 */
const PARALLEL: EnergyGraph = {
  nodes: [
    { key: "source", switching: false, fanOut: false },
    { key: "b1", switching: true, fanOut: false },
    { key: "b2", switching: true, fanOut: false },
    { key: "cable", switching: false, fanOut: false },
    { key: "bus", switching: false, fanOut: false },
    { key: "load", switching: false, fanOut: false },
  ],
  pipes: [
    { from: "source", to: "b1" },
    { from: "b1", to: "bus" },
    { from: "source", to: "b2" },
    { from: "b2", to: "cable" },
    { from: "cable", to: "bus" },
    { from: "bus", to: "load" },
  ],
  sources: ["source"],
};

function states(entries: Record<string, readonly SwitchState[]>): ReadonlyMap<string, readonly SwitchState[]> {
  return new Map(Object.entries(entries));
}

function walk(graph: EnergyGraph, switchStates: ReadonlyMap<string, readonly SwitchState[]>) {
  const result = energiseGraph(graph, switchStates);
  if (result === null) {
    throw new Error("expected a walk, got null");
  }
  return result;
}

function pipeIs(
  result: { pipes: ReadonlyMap<string, Energy> },
  from: string,
  to: string,
  expected: Energy,
  context: string,
): void {
  const actual = result.pipes.get(mimicPipeKey(from, to));
  assert(actual === expected, `${context}: pipe ${from}→${to} — expected ${expected}, got ${actual}`);
}

/** A closed breaker energises every segment. */
export function closedEnergisesEverySegment(): void {
  const result = walk(CHAIN, states({ breaker: ["closed"] }));
  pipeIs(result, "source", "breaker", "energised", "closed");
  pipeIs(result, "breaker", "bus", "energised", "closed");
  pipeIs(result, "bus", "load", "energised", "closed");
  assert(result.nodes.get("load") === "energised", `closed: load — got ${result.nodes.get("load")}`);
}

/** An open breaker de-energises after itself and leaves the segment before it energised. */
export function openStopsAfterTheBreaker(): void {
  const result = walk(CHAIN, states({ breaker: ["open"] }));
  pipeIs(result, "source", "breaker", "energised", "open");
  pipeIs(result, "breaker", "bus", "de-energised", "open");
  pipeIs(result, "bus", "load", "de-energised", "open");
}

/** A tripped breaker stops energy as an open one does. */
export function trippedStopsAfterTheBreaker(): void {
  const result = walk(CHAIN, states({ breaker: ["tripped"] }));
  pipeIs(result, "breaker", "bus", "de-energised", "tripped");
}

/** A stale (unknown) member makes everything after the breaker unknown. */
export function staleMemberIsUnknownAfter(): void {
  const result = walk(CHAIN, states({ breaker: ["unknown"] }));
  pipeIs(result, "source", "breaker", "energised", "unknown member");
  pipeIs(result, "breaker", "bus", "unknown", "unknown member");
  pipeIs(result, "bus", "load", "unknown", "unknown member");
}

/** Two breakers into one bus, one open (listed first) one closed: the bus is energised (OR). */
export function parallelOpenAndClosedIsEnergised(): void {
  const result = walk(PARALLEL, states({ b1: ["open"], b2: ["closed"] }));
  pipeIs(result, "bus", "load", "energised", "b1 open, b2 closed");
  // The node past the join: only a walk that re-walks the bus when b2's energy arrives raises it.
  assert(result.nodes.get("load") === "energised", `b1 open, b2 closed: load — got ${result.nodes.get("load")}`);
}

/** Two breakers into one bus, one unknown one open: the bus is unknown. */
export function parallelUnknownAndOpenIsUnknown(): void {
  const result = walk(PARALLEL, states({ b1: ["open"], b2: ["unknown"] }));
  pipeIs(result, "bus", "load", "unknown", "b1 open, b2 unknown");
  assert(result.nodes.get("load") === "unknown", `b1 open, b2 unknown: load — got ${result.nodes.get("load")}`);
}

/** A fan-out breaker passes energy when any member is closed (the open member listed first). */
export function fanOutAnyClosedIsEnergised(): void {
  const result = walk(CHAIN, states({ breaker: ["open", "closed"] }));
  pipeIs(result, "breaker", "bus", "energised", "members open, closed");
}

/** A fan-out breaker with an unknown member and no closed one gives unknown. */
export function fanOutUnknownAndOpenIsUnknown(): void {
  const result = walk(CHAIN, states({ breaker: ["open", "unknown"] }));
  pipeIs(result, "breaker", "bus", "unknown", "members open, unknown");
}

/** A switching node with no members (absent from the map, or an empty list) gives unknown. */
export function noMembersIsUnknown(): void {
  pipeIs(walk(CHAIN, states({})), "breaker", "bus", "unknown", "absent from the map");
  pipeIs(walk(CHAIN, states({ breaker: [] })), "breaker", "bus", "unknown", "an empty member list");
}

/** A graph with no source is not walked. */
export function noSourcesIsNull(): void {
  const result = energiseGraph({ ...CHAIN, sources: [] }, states({ breaker: ["closed"] }));
  assert(result === null, `sources: [] — expected null, got ${JSON.stringify(result)}`);
}

/** A non-source node with no inbound pipe is de-energised, and so is its outbound pipe. */
export function anUnfedNodeIsDeEnergised(): void {
  const graph: EnergyGraph = {
    nodes: [...CHAIN.nodes, { key: "island", switching: false, fanOut: false }],
    pipes: [...CHAIN.pipes, { from: "island", to: "load" }],
    sources: ["source"],
  };
  const result = walk(graph, states({ breaker: ["closed"] }));
  assert(result.nodes.get("island") === "de-energised", `island — got ${result.nodes.get("island")}`);
  pipeIs(result, "island", "load", "de-energised", "unfed island");
  assert(result.nodes.get("source") === "energised", `source — got ${result.nodes.get("source")}`);
}

/** A drawn cycle terminates, and the walk still reaches past it. */
export function aCycleTerminates(): void {
  const graph: EnergyGraph = {
    nodes: [
      { key: "source", switching: false, fanOut: false },
      { key: "a", switching: false, fanOut: false },
      { key: "b", switching: false, fanOut: false },
      { key: "c", switching: false, fanOut: false },
    ],
    pipes: [
      { from: "source", to: "a" },
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "b", to: "c" },
    ],
    sources: ["source"],
  };
  const result = walk(graph, states({}));
  pipeIs(result, "b", "a", "energised", "cycle");
  pipeIs(result, "b", "c", "energised", "cycle");
}

/** A bus over two breakers, for `worstDownstreamSwitch`. */
const BUS: EnergyGraph = {
  nodes: [
    { key: "bus", switching: false, fanOut: false },
    { key: "b1", switching: true, fanOut: true },
    { key: "b2", switching: true, fanOut: false },
    { key: "meter", switching: false, fanOut: false },
  ],
  pipes: [
    { from: "bus", to: "b1" },
    { from: "bus", to: "b2" },
    { from: "bus", to: "meter" },
  ],
  sources: [],
};

function worst(b1: readonly SwitchState[], b2: readonly SwitchState[]): SwitchState | null {
  return worstDownstreamSwitch(BUS, "bus", states({ b1, b2 }));
}

/** tripped beats open. */
export function worstTrippedBeatsOpen(): void {
  const w = worst(["open"], ["closed", "tripped"]);
  assert(w === "tripped", `open + tripped — expected tripped, got ${w}`);
}

/** open beats unknown. */
export function worstOpenBeatsUnknown(): void {
  const w = worst(["unknown"], ["open"]);
  assert(w === "open", `unknown + open — expected open, got ${w}`);
}

/** unknown beats closed. */
export function worstUnknownBeatsClosed(): void {
  const w = worst(["closed"], ["unknown"]);
  assert(w === "unknown", `closed + unknown — expected unknown, got ${w}`);
}

/** All closed is closed. */
export function worstAllClosedIsClosed(): void {
  const w = worst(["closed", "closed"], ["closed"]);
  assert(w === "closed", `all closed — expected closed, got ${w}`);
}

/** A node with no direct downstream switching node answers null (the passive look stays). */
export function worstWithNoDownstreamSwitchIsNull(): void {
  const w = worstDownstreamSwitch(BUS, "meter", states({ b1: ["tripped"] }));
  assert(w === null, `meter — expected null, got ${w}`);
}
