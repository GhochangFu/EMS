import type { CalcCrossRef } from "@bms/shared";
import { crossRefKey, windowKey } from "@bms/shared";

import type { CalcRuntimeSkipReason } from "../observability/metrics.service";
import { resolveAggregate } from "./calc-aggregate";
import { inputKey } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";
import type { Membership, NodeId } from "./calc-graph";
import { classifyInput, type CalcInputSample } from "./calc-inputs";
import type { CalcInputsService } from "./calc-inputs.service";
import { windowRequestKey, type WindowReadRequest, type WindowReadResult } from "./calc-windows.service";

/**
 * **The input assembly both evaluation hosts call** (ADR 0097 decision 5, the
 * named carve-out). Moved out of `calc-scheduler.service.ts` unchanged in
 * order: parameters → local references → cross references → window reads.
 * The scheduler's tick, graph order, `refuse` and writes stay where they were.
 *
 * Two things differ from the code as it stood inside the scheduler, and both
 * are the point of the move:
 *
 * - **A refusal is a returned value**, never a call to `refuse`. The scheduler
 *   calls its own `refuse` with the returned reason, so every scheduler
 *   refusal is still counted and recorded by one function; the KPI host maps
 *   the reason to a response state and counts nothing. This file never names
 *   the metrics service or the status registry (part (e) complement of
 *   `tests/adr-0055-calc-v2-invariants.test.ts`).
 * - **Three read-only facts ride on every result**, success or refusal:
 *   `memberCount`, `membersNotFresh` and `oldestInputMs`. The scheduler
 *   ignores all three; the KPI host reports them (ADR 0097 decisions 2, 3).
 */

/**
 * The values computed earlier in **this** sweep, keyed by `inputKey` — the
 * `computedThisTick` overlay of plan design decision 7. Consulted before every
 * read, so a same-tick chain propagates within the tick while the write stays
 * one batch at the end.
 *
 * An entry's `timeMs` is the **bucketed** time the write will carry, never
 * `nowMs` (plan correction 60): the overlay is a read-through of a write that
 * is about to happen, not a second freshness claim about the same number. A
 * downstream formula whose `max_input_age_seconds` is tighter than its input's
 * own interval therefore reads `stale_input` here exactly as it would from the
 * stored row one tick later — decision 5 reporting a real misconfiguration,
 * rather than the overlay hiding it on the tick the member was recomputed.
 */
export type ComputedThisTick = ReadonlyMap<NodeId, CalcInputSample>;

/** The overlay a host with no sweep passes — a KPI is read, never computed this tick. */
export const NO_OVERLAY: ComputedThisTick = new Map();

/** What the assembly reads of a definition. A KPI has no `templatePointId`,
 * `pointKey`, `trigger` or interval, and this module must not need them; a
 * `CalcDefinition` satisfies the `Pick` structurally. */
export type AssemblyDefinition = Pick<
  CalcDefinition,
  "assetId" | "refs" | "crossRefs" | "paramRefs" | "windowReads" | "maxInputAgeSeconds" | "minCoverageRatio"
>;

/** Every reason the assembly can refuse with — a subset of the scheduler's vocabulary. */
export type AssemblyRefusalReason = Extract<
  CalcRuntimeSkipReason,
  | "parameter_unset"
  | "missing_input"
  | "stale_input"
  | "unknown_asset_reference"
  | "no_members"
  | "coverage_below_floor"
  | "windows_unresolved"
  | "window_empty"
  | "window_sparse"
  | "timezone_unset"
>;

/**
 * The read-only facts on every result.
 *
 * - `memberCount`: the declared members over every aggregate, from membership
 *   alone (no read).
 * - `membersNotFresh`: of those, the ones stale or missing — classified over
 *   **every** member of **every** aggregate from the one batched pairs read,
 *   before the declared-order refusal loop (ADR 0097 decision 3). `0` when the
 *   pairs read never ran (a refusal above it).
 * - `oldestInputMs`: the minimum `timeMs` over every sample this call read —
 *   local, qualified and member, fresh or stale; `null` when none was read.
 */
export type AssemblyReading = {
  readonly memberCount: number;
  readonly membersNotFresh: number;
  readonly oldestInputMs: number | null;
};

export type AssembledInputs = AssemblyReading & {
  readonly ok: true;
  readonly inputs: Map<string, number>;
  /** `undefined` for a definition with no cross reference — as `evaluate` was always called. */
  readonly crossInputs: Map<string, number> | undefined;
  readonly params: Map<string, number>;
  readonly windowValues: Map<string, number>;
  /** The sum of `resolveAggregate(...).excluded` — see the scheduler's counter. */
  readonly excluded: number;
};

export type AssemblyRefusal = AssemblyReading & { readonly ok: false; readonly reason: AssemblyRefusalReason };

export type CalcInputAssemblyDeps = {
  inputs: Pick<CalcInputsService, "getLatestSamples" | "getLatestSamplesForPairs">;
};

type Pair = { readonly assetId: string; readonly pointKey: string };

/** The mutable side of {@link AssemblyReading}, filled as the reads happen. */
type ReadingState = { memberCount: number; membersNotFresh: number; oldestInputMs: number | null };

function noteSamples(state: ReadingState, samples: Iterable<CalcInputSample>): void {
  for (const sample of samples) {
    if (state.oldestInputMs === null || sample.timeMs < state.oldestInputMs) {
      state.oldestInputMs = sample.timeMs;
    }
  }
}

function refusal(state: ReadingState, reason: AssemblyRefusalReason): AssemblyRefusal {
  return { ok: false, reason, ...state };
}

/**
 * The samples for `pairs`, overlay first and one batched read for the rest.
 * Keyed by `inputKey`, like the pairs read itself.
 */
async function readPairSamples(
  deps: CalcInputAssemblyDeps,
  pairs: readonly Pair[],
  computedThisTick: ComputedThisTick,
): Promise<Map<string, CalcInputSample>> {
  const samples = new Map<string, CalcInputSample>();
  const unread: Pair[] = [];
  for (const pair of pairs) {
    const key = inputKey(pair.assetId, pair.pointKey);
    const computed = computedThisTick.get(key);
    if (computed) {
      samples.set(key, computed);
    } else {
      unread.push(pair);
    }
  }
  if (unread.length > 0) {
    for (const [key, sample] of await deps.inputs.getLatestSamplesForPairs(unread)) {
      samples.set(key, sample);
    }
  }
  return samples;
}

/** One cross reference and the `(assetId, pointKey)` pairs it reads. */
type CrossRead = { readonly ref: CalcCrossRef; readonly key: string; readonly pairs: readonly Pair[] };

/**
 * What one definition's cross references resolved to: the values keyed by
 * `crossRefKey`, and the members every aggregate in the formula excluded.
 *
 * **`excluded` is carried out rather than counted here**, which is the whole
 * point of the shape. `bms_api_calc_aggregate_members_excluded_total`'s own
 * help text says "excluded … from a value that was still written", so the
 * count belongs to the *write*, not to the aggregate that happened to resolve
 * first. Counted inside the loop below it moved for a formula that then
 * refused on a later reference — a stale `{CODE.key}` after the aggregate, a
 * second aggregate below the coverage floor, a `non_finite` result — and the
 * counter reported exclusions from values that were never written.
 */
type CrossInputs = { readonly ok: true; readonly values: Map<string, number>; readonly excluded: number };

/**
 * `crossInputs` for one `v2` definition (ADR 0055 decisions 11 and 12), or the
 * refusal. A `{CODE.key}` whose code resolved to nothing at the owner's
 * location is `unknown_asset_reference` — for every qualified reference,
 * before the pairs read; a resolved one is classified exactly like a local
 * input. Each aggregate goes through `resolveAggregate` over its declared
 * members, and its exclusions are **totalled and returned**, for the
 * scheduler to count beside `noteWritten` once the formula has actually
 * produced a value.
 */
async function resolveCrossInputs(
  deps: CalcInputAssemblyDeps,
  def: AssemblyDefinition,
  nowMs: number,
  membership: Membership,
  computedThisTick: ComputedThisTick,
  state: ReadingState,
): Promise<CrossInputs | AssemblyRefusal> {
  const qualified = membership.qualified.get(def.assetId);
  const members = membership.members.get(def.assetId);

  const reads: CrossRead[] = [];
  for (const ref of def.crossRefs) {
    const key = crossRefKey(ref);
    if (ref.kind === "qref") {
      const assetId = qualified?.get(ref.assetCode);
      if (assetId === null || assetId === undefined) {
        return refusal(state, "unknown_asset_reference");
      }
      reads.push({ ref, key, pairs: [{ assetId, pointKey: ref.pointKey }] });
    } else {
      reads.push({ ref, key, pairs: members?.get(key) ?? [] });
    }
  }

  const samples = await readPairSamples(
    deps,
    reads.flatMap((read) => read.pairs),
    computedThisTick,
  );
  noteSamples(state, samples.values());
  const sampleOf = (pair: Pair): CalcInputSample | undefined => samples.get(inputKey(pair.assetId, pair.pointKey));

  // ADR 0097 decision 3: every declared member of every aggregate, classified
  // before the declared-order loop below can return at the first refusal.
  for (const { ref, pairs } of reads) {
    if (ref.kind === "qref") continue;
    for (const pair of pairs) {
      if (classifyInput(sampleOf(pair), nowMs, def.maxInputAgeSeconds) !== "fresh") {
        state.membersNotFresh += 1;
      }
    }
  }

  const values = new Map<string, number>();
  let excluded = 0;
  for (const { ref, key, pairs } of reads) {
    if (ref.kind === "qref") {
      const sample = sampleOf(pairs[0]);
      const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
      if (classification !== "fresh" || !sample) {
        return refusal(state, classification === "missing" ? "missing_input" : "stale_input");
      }
      values.set(key, sample.value);
      continue;
    }
    const result = resolveAggregate(ref.fn, pairs.map(sampleOf), nowMs, def.maxInputAgeSeconds, def.minCoverageRatio);
    if (!result.ok) {
      return refusal(state, result.reason);
    }
    // Accumulated, never counted here — see {@link CrossInputs}. A refusal from
    // a later reference in this same loop discards the total with the map.
    excluded += result.excluded;
    values.set(key, result.value);
  }
  return { ok: true, values, excluded };
}

/** The declared members over every aggregate of `def`, from membership alone. */
function countDeclaredMembers(def: AssemblyDefinition, membership: Membership): number {
  const members = membership.members.get(def.assetId);
  let count = 0;
  for (const ref of def.crossRefs) {
    if (ref.kind === "aggregate") {
      count += members?.get(crossRefKey(ref))?.length ?? 0;
    }
  }
  return count;
}

/**
 * Every input one definition's `evaluate` call needs, or the first refusal in
 * declared order. `windowEndMs` is the end every window read of this
 * definition was requested at (ADR 0097 "Ruled here": the scheduler's
 * bucketed tick, the KPI host's minute floor) — a parameter because a KPI has
 * no interval to bucket on.
 */
export async function assembleInputs(
  deps: CalcInputAssemblyDeps,
  def: AssemblyDefinition,
  nowMs: number,
  membership: Membership,
  computedThisTick: ComputedThisTick,
  parameters: ReadonlyMap<string, number>,
  windows: ReadonlyMap<string, WindowReadResult>,
  windowEndMs: number,
): Promise<AssembledInputs | AssemblyRefusal> {
  const state: ReadingState = { memberCount: countDeclaredMembers(def, membership), membersNotFresh: 0, oldestInputMs: null };

  // Parameters first (ADR 0070 decision 2): a `$key` with no row in scope is
  // `parameter_unset` before any input is read, so a missing parameter never
  // pays a pairs read. `parameters` is keyed by `inputKey(assetId, key)` and
  // an absent key is absent — the resolver never defaults, and neither does
  // this: the fourth map is built only from what resolved.
  const params = new Map<string, number>();
  for (const key of def.paramRefs) {
    const value = parameters.get(inputKey(def.assetId, key));
    if (value === undefined) {
      return refusal(state, "parameter_unset");
    }
    params.set(key, value);
  }

  // Local references: the overlay first, then one batched read for the rest —
  // a `v1` formula never hits the overlay (its refs are never derived, which
  // `v1_references_derived` holds at read time), so its read is unchanged.
  const samples = new Map<string, CalcInputSample>();
  const unread: string[] = [];
  for (const ref of def.refs) {
    const computed = computedThisTick.get(inputKey(def.assetId, ref));
    if (computed) {
      samples.set(ref, computed);
    } else {
      unread.push(ref);
    }
  }
  if (unread.length > 0) {
    for (const [ref, sample] of await deps.inputs.getLatestSamples(def.assetId, unread)) {
      samples.set(ref, sample);
    }
  }
  noteSamples(state, samples.values());
  const inputs = new Map<string, number>();
  for (const ref of def.refs) {
    const sample = samples.get(ref);
    const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
    if (classification !== "fresh" || !sample) {
      return refusal(state, classification === "missing" ? "missing_input" : "stale_input");
    }
    inputs.set(ref, sample.value);
  }

  let crossInputs: Map<string, number> | undefined;
  let excluded = 0;
  if (def.crossRefs.length > 0) {
    const resolved = await resolveCrossInputs(deps, def, nowMs, membership, computedThisTick, state);
    if (!resolved.ok) {
      return resolved;
    }
    crossInputs = resolved.values;
    excluded = resolved.excluded;
  }

  // Window reads last (`E4.1b`, design decision 10): the point inside a
  // window is in `refs`/`crossRefs` and was classified above, so a meter
  // with no reading at all is `missing_input` and a stale one `stale_input`
  // — as a `v1` formula over it would be — and only a LIVE meter with
  // nothing inside the window reaches `window_empty`. `windows` is keyed by
  // `windowRequestKey`; an answer absent from the batch is a failed read,
  // never a value.
  const windowValues = new Map<string, number>();
  for (const node of def.windowReads) {
    const answer = windows.get(windowRequestKey(def.assetId, node, windowEndMs));
    if (answer === undefined) {
      return refusal(state, "windows_unresolved");
    }
    if (!answer.ok) {
      return refusal(state, answer.reason);
    }
    windowValues.set(windowKey(node), answer.value);
  }

  return { ok: true, inputs, crossInputs, params, windowValues, excluded, ...state };
}

/**
 * The window reads one definition needs at `endMs`. A qualified read's asset
 * comes through `membership.qualified`, exactly as the cross-reference path
 * resolves it; a code that resolves to nothing is skipped here and refused as
 * `unknown_asset_reference` by {@link assembleInputs}.
 */
export function planWindowRequests(
  def: Pick<AssemblyDefinition, "assetId" | "windowReads">,
  membership: Membership,
  endMs: number,
): WindowReadRequest[] {
  const requests: WindowReadRequest[] = [];
  for (const node of def.windowReads) {
    let readAssetId: string | null | undefined = def.assetId;
    if (node.kind === "window" && node.ref.kind === "qref") {
      readAssetId = membership.qualified.get(def.assetId)?.get(node.ref.assetCode);
    }
    if (readAssetId === null || readAssetId === undefined) continue;
    requests.push({ ownerAssetId: def.assetId, readAssetId, node, endMs });
  }
  return requests;
}
