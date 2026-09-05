import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import type { CalcCrossRef } from "@bms/shared";
import { CALC_DIALECT, crossRefKey, evaluate } from "@bms/shared";

import { sleep } from "../telemetry/sleep";
import { MetricsService, type CalcRuntimeSkipReason } from "../observability/metrics.service";
import { resolveAggregate } from "./calc-aggregate";
import { defKey, inputKey } from "./calc-batch";
import type { CalcDefinition } from "./calc-definition";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { buildCalcGraph, topologicalOrder, type Membership, type NodeId } from "./calc-graph";
import { classifyInput, type CalcInputSample } from "./calc-inputs";
import { CalcInputsService } from "./calc-inputs.service";
import { bucketTimeMs, isDue } from "./calc-schedule";
import { CalcScopeService } from "./calc-scope.service";
import { CalcStatusRegistry } from "./calc-status.registry";
import { CalcWriteService, type CalcWriteInput } from "./calc-write.service";

/** Never one timer per formula (ADR 0037 decision 7) — one loop, this base
 * tick, each sweep checking every scheduled formula's own `isDue`. */
const BASE_TICK_MS = 10_000;

export interface CalcSchedulerDeps {
  definitions: Pick<CalcDefinitionsService, "getScheduledDefinitions">;
  inputs: Pick<CalcInputsService, "getLatestSamples" | "getLatestSamplesForPairs">;
  /** `F2.9` — membership for `bms-calc-v2`, resolved once per sweep (plan design decision 8). */
  scope: Pick<CalcScopeService, "resolveMembership">;
  writer: Pick<CalcWriteService, "writeValues">;
  metrics: Pick<MetricsService, "countCalcSkipped" | "countCalcAggregateExcluded" | "setCalcAggregateMembersMax">;
  /** `F2.9` Task 16 — design decision 9, layer 3: what the per-asset page reads. */
  status: Pick<CalcStatusRegistry, "record">;
  logger: Pick<Logger, "warn">;
}

/**
 * **The one place this host refuses a formula.** Every refusal counts *and*
 * records, and it does so through here rather than beside each `if`.
 *
 * There are eight refusal sites in this file and Task 13 alone added five new
 * reasons, so a `record` written out beside each `countCalcSkipped` gives the
 * next refusal eight chances to be counted but not recorded — a point that
 * shows the previous outcome forever, or `null`, while the counter moves. The
 * two facts are one event and are emitted by one function.
 *
 * `tests/adr-0055-calc-v2-invariants.test.ts` part (e) holds it as source
 * structure: `countCalcSkipped(` may not appear in this file outside this
 * function.
 *
 * Returns `null` so a caller can `return refuse(…)` — every refusal site here
 * either returns `null` or `continue`s.
 *
 * `nowMs` is the sweep's own tick time, threaded in rather than read from the
 * clock, so what the page shows is the pass that actually made the decision.
 */
function refuse(deps: CalcSchedulerDeps, def: CalcDefinition, reason: CalcRuntimeSkipReason, nowMs: number): null {
  deps.metrics.countCalcSkipped(reason);
  deps.status.record(def.assetId, def.templatePointId, { outcome: "skipped", reason, atMs: nowMs });
  return null;
}

/** The other half of {@link refuse}: a formula that produced a value this pass. */
function noteWritten(deps: CalcSchedulerDeps, def: CalcDefinition, nowMs: number): void {
  deps.status.record(def.assetId, def.templatePointId, { outcome: "written", reason: null, atMs: nowMs });
}

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
type ComputedThisTick = ReadonlyMap<NodeId, CalcInputSample>;

type Pair = { readonly assetId: string; readonly pointKey: string };

const EMPTY_MEMBERSHIP: Membership = { qualified: new Map(), members: new Map() };

/**
 * The samples for `pairs`, overlay first and one batched read for the rest.
 * Keyed by `inputKey`, like the pairs read itself.
 */
async function readPairSamples(
  deps: CalcSchedulerDeps,
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
type CrossInputs = { readonly values: Map<string, number>; readonly excluded: number };

/**
 * `crossInputs` for one `v2` definition (ADR 0055 decisions 11 and 12), or
 * `null` after counting the refusal. A `{CODE.key}` whose code resolved to
 * nothing at the owner's location is `unknown_asset_reference`; a resolved one
 * is classified exactly like a local input. Each aggregate goes through
 * `resolveAggregate` over its declared members, and its exclusions are
 * **totalled and returned**, for `runScheduledSweep` to count beside
 * `noteWritten` once the formula has actually produced a value.
 *
 * `null` stays the failure sentinel, so every `return refuse(…)` site below is
 * untouched.
 */
async function resolveCrossInputs(
  deps: CalcSchedulerDeps,
  def: CalcDefinition,
  nowMs: number,
  membership: Membership,
  computedThisTick: ComputedThisTick,
): Promise<CrossInputs | null> {
  const qualified = membership.qualified.get(def.assetId);
  const members = membership.members.get(def.assetId);

  const reads: CrossRead[] = [];
  for (const ref of def.crossRefs) {
    const key = crossRefKey(ref);
    if (ref.kind === "qref") {
      const assetId = qualified?.get(ref.assetCode);
      if (assetId === null || assetId === undefined) {
        return refuse(deps, def, "unknown_asset_reference", nowMs);
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
  const sampleOf = (pair: Pair): CalcInputSample | undefined => samples.get(inputKey(pair.assetId, pair.pointKey));

  const values = new Map<string, number>();
  let excluded = 0;
  for (const { ref, key, pairs } of reads) {
    if (ref.kind === "qref") {
      const sample = sampleOf(pairs[0]);
      const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
      if (classification !== "fresh" || !sample) {
        return refuse(deps, def, classification === "missing" ? "missing_input" : "stale_input", nowMs);
      }
      values.set(key, sample.value);
      continue;
    }
    const result = resolveAggregate(ref.fn, pairs.map(sampleOf), nowMs, def.maxInputAgeSeconds, def.minCoverageRatio);
    if (!result.ok) {
      return refuse(deps, def, result.reason, nowMs);
    }
    // Accumulated, never counted here — see {@link CrossInputs}. A refusal from
    // a later reference in this same loop discards the total with the map.
    excluded += result.excluded;
    values.set(key, result.value);
  }
  return { values, excluded };
}

/**
 * One formula's successful pass: the row to write, and the aggregate members
 * that were excluded from it. Both, together, because the counter's meaning is
 * "excluded from a value that was still written" — see {@link CrossInputs}.
 * `null` remains the failure sentinel, so the refusal sites are unchanged.
 */
type ScheduledOutcome = { readonly write: CalcWriteInput; readonly excluded: number };

async function evaluateOneScheduledFormula(
  deps: CalcSchedulerDeps,
  def: CalcDefinition,
  nowMs: number,
  membership: Membership,
  computedThisTick: ComputedThisTick,
): Promise<ScheduledOutcome | null> {
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
  const inputs = new Map<string, number>();
  for (const ref of def.refs) {
    const sample = samples.get(ref);
    const classification = classifyInput(sample, nowMs, def.maxInputAgeSeconds);
    if (classification !== "fresh" || !sample) {
      return refuse(deps, def, classification === "missing" ? "missing_input" : "stale_input", nowMs);
    }
    inputs.set(ref, sample.value);
  }

  let crossInputs: Map<string, number> | undefined;
  let excluded = 0;
  if (def.crossRefs.length > 0) {
    const resolved = await resolveCrossInputs(deps, def, nowMs, membership, computedThisTick);
    if (resolved === null) {
      return null;
    }
    crossInputs = resolved.values;
    excluded = resolved.excluded;
  }

  const result = evaluate(def.ast, inputs, crossInputs);
  if (!result.ok) {
    // The last exit above the write, and the reason `excluded` is still only a
    // number here: a `non_finite` result discards it with everything else.
    return refuse(deps, def, "non_finite", nowMs);
  }

  return {
    write: {
      assetId: def.assetId,
      pointKey: def.pointKey,
      // Tick time truncated to the formula's own interval (ADR 0037 decision
      // 8) — a late sweep still writes its bucket's timestamp, which is what
      // keeps a recompute a database no-op and the derived series regular.
      time: new Date(bucketTimeMs(nowMs, def.intervalSeconds ?? 0)),
      value: result.value,
    },
    excluded,
  };
}

/**
 * Design decision 9, layer 2: one `warn` per **transition** into or out of
 * the cyclic set — never once per tick, which for a cycle that persists would
 * be a line every 10 seconds saying nothing new. Node ids are
 * `assetId:pointKey`; formula text is tenant content and never logged.
 * `previous` is the loop's own state and is brought up to date in place.
 */
function logCycleTransitions(deps: CalcSchedulerDeps, previous: Set<NodeId>, current: ReadonlySet<NodeId>): void {
  const entered = [...current].filter((id) => !previous.has(id));
  const left = [...previous].filter((id) => !current.has(id));
  if (entered.length > 0) {
    deps.logger.warn(
      `calc scheduler: dependency cycle now includes ${entered.join(", ")} — each is refused as ` +
        "dependency_cycle every due window until the cycle is broken (ADR 0055 decision 8)",
    );
  }
  if (left.length > 0) {
    deps.logger.warn(`calc scheduler: dependency cycle no longer includes ${left.join(", ")}`);
  }
  previous.clear();
  for (const id of current) {
    previous.add(id);
  }
}

/** The largest declared member set of any aggregate, as resolved this sweep. */
function largestMemberSet(membership: Membership): number {
  let largest = 0;
  for (const byKey of membership.members.values()) {
    for (const pairs of byKey.values()) {
      largest = Math.max(largest, pairs.length);
    }
  }
  return largest;
}

/**
 * One sweep: every active scheduled formula whose own interval has elapsed.
 * `lastRunMs` is owned by the caller and mutated in place — the loop's own
 * state, threaded through rather than captured, so this function stays
 * testable without a live timer. **No cap on formulas per tick** (decision
 * 7): silently computing a subset would be a worse failure than being slow.
 *
 * **Order (`F2.9`, ADR 0055 decisions 7, 8 and 11).** Membership is resolved
 * once, for every scheduled definition; the graph is built over the whole
 * scheduled set and sorted; the sweep then walks `order` — every node after
 * everything it reads — and the cyclic set last. A `v1` node has no edges and
 * sorts first, so its behaviour is unchanged. Each formula keeps its own
 * `try`/`catch`. What a formula computes goes into `computedThisTick` **and**
 * `toWrite`: the overlay lets a same-tick chain propagate; the batch is still
 * one write at the end.
 *
 * **Every refusal counts once per due window**, below `lastRunMs.set` (plan
 * correction 61), and goes through {@link refuse}, which counts and records it
 * together: `dependency_cycle` and `membership_unresolved` here, and
 * `unknown_asset_reference`, `no_members`, `coverage_below_floor`,
 * `missing_input` and `stale_input` inside the evaluation. Above that line a
 * refusal would re-count on every 10-second base tick and
 * `bms_api_calc_skipped_total` would stop meaning "refused per due window".
 *
 * **Membership failure is contained to `v2`.** The `try`/`catch` wraps the
 * `resolveMembership` call alone. When it throws, every due `v2` definition —
 * aggregate or local-only alike, since neither its edges nor its cycles can be
 * known — counts `membership_unresolved`, and every `v1` definition still
 * evaluates and still writes. The graph is then built over an empty membership,
 * so a purely local cycle is still refused, and the cyclic-set log is left
 * alone rather than fed a partial graph.
 *
 * **Downstream of a cycle is not refused** (design decision 7, ruling Q6):
 * the members are, and a formula that merely reads one computes from the stored
 * value until decision 5's staleness rule refuses it honestly.
 *
 * `previousCyclic` is the loop's other piece of state, for the transition log
 * (design decision 9, layer 2). A one-shot caller may omit it, in which case
 * every cycle found is a transition and is logged.
 *
 * The key is `(assetId, templatePointId)`, never `templatePointId` alone —
 * one published template can be instantiated on many assets, and each is a
 * separate formula instance with its own schedule. Keying on the bare
 * template point id let the first asset processed in a sweep mark every
 * other asset sharing that template point as "just ran", starving them
 * forever with no counted skip.
 *
 * The stored value is the formula's own **bucketed** tick time
 * (`bucketTimeMs`), not the raw `nowMs` the sweep happened to run at. Raw
 * wall-clock storage re-arms relative to whatever instant the previous fire
 * happened to land on; against variable sweep cost (each sweep nudges the
 * next tick's `now()` a little later), that reference keeps sliding forward
 * and a `lastRun + interval` check against it can go a whole extra tick
 * without firing before it catches up. Bucketed storage re-arms against the
 * fixed bucket grid instead, so it fires as soon as `nowMs` crosses into a
 * bucket beyond the last one recorded — never later than raw storage would,
 * and sometimes a tick earlier. `calc-scheduler.spec.ts`'s drift test proves
 * the count: the same 9-tick, cost-per-tick schedule produces one more write
 * under bucketed storage than it would under raw storage.
 */
export async function runScheduledSweep(
  deps: CalcSchedulerDeps,
  lastRunMs: Map<string, number>,
  nowMs: number,
  previousCyclic: Set<NodeId> = new Set(),
): Promise<void> {
  const scheduled = await deps.definitions.getScheduledDefinitions();
  const toWrite: CalcWriteInput[] = [];
  const computedThisTick = new Map<NodeId, CalcInputSample>();

  let membership: Membership | null;
  try {
    membership = await deps.scope.resolveMembership(scheduled);
  } catch (err) {
    membership = null;
    deps.logger.warn(
      `calc scheduler: membership resolution failed; every bms-calc-v2 formula due this sweep is ` +
        `refused as membership_unresolved: ${(err as Error)?.message ?? err}`,
    );
  }
  const graph = buildCalcGraph(scheduled, membership ?? EMPTY_MEMBERSHIP);
  const { order, cyclic } = topologicalOrder(graph);
  if (membership !== null) {
    logCycleTransitions(deps, previousCyclic, cyclic);
    deps.metrics.setCalcAggregateMembersMax(largestMemberSet(membership));
  }

  // One definition per node — `buildCalcGraph` keeps the first for an id, as
  // this does; the loader's invariant (one derived row per asset per key) is
  // what makes the two agree.
  const defById = new Map<NodeId, CalcDefinition>();
  for (const def of scheduled) {
    const id = inputKey(def.assetId, def.pointKey);
    if (!defById.has(id)) defById.set(id, def);
  }

  for (const id of [...order, ...cyclic]) {
    const def = defById.get(id);
    if (!def) continue;
    if (def.intervalSeconds === null || def.intervalSeconds <= 0) {
      // Unreachable via CalcDefinitionsService — toActiveDefinition
      // guarantees a scheduled definition carries a positive interval
      // (MIN_CALC_INTERVAL_SECONDS = 10) — but this function's own contract
      // must not assume its caller. `null` or `0` would fall through to
      // bucketTimeMs(nowMs, 0): divide by zero, store NaN in lastRunMs, and
      // make isDue return false forever for this key — a silent, permanent
      // stop rather than one counted skip (decision 9). A negative interval
      // is the milder sibling: isDue becomes always-true and the formula
      // fires every base tick against a negative bucket grid. All three are
      // the same "this definition cannot be scheduled" case.
      refuse(deps, def, "missing_interval", nowMs);
      continue;
    }
    const key = defKey(def.assetId, def.templatePointId);
    const intervalSeconds = def.intervalSeconds;
    if (!isDue({ intervalSeconds, lastRunMs: lastRunMs.get(key) ?? null, nowMs })) {
      continue;
    }
    lastRunMs.set(key, bucketTimeMs(nowMs, intervalSeconds));
    // Every refusal from here down counts once per due window (correction 61).
    if (cyclic.has(id)) {
      refuse(deps, def, "dependency_cycle", nowMs);
      continue;
    }
    if (membership === null && def.dialect !== CALC_DIALECT) {
      refuse(deps, def, "membership_unresolved", nowMs);
      continue;
    }
    try {
      const outcome = await evaluateOneScheduledFormula(deps, def, nowMs, membership ?? EMPTY_MEMBERSHIP, computedThisTick);
      if (outcome) {
        toWrite.push(outcome.write);
        noteWritten(deps, def, nowMs);
        // **Here, and nowhere deeper.** The counter reads "members excluded
        // from a value that was still written", so it moves on the same branch
        // as `noteWritten` — beside the write, not beside the aggregate that
        // resolved. A formula that resolved one aggregate and then refused on a
        // later reference never reaches this line.
        if (outcome.excluded > 0) {
          deps.metrics.countCalcAggregateExcluded(outcome.excluded);
        }
        computedThisTick.set(id, { value: outcome.write.value, timeMs: outcome.write.time.getTime() });
      }
    } catch (err) {
      deps.logger.warn(
        `calc scheduler: formula "${def.pointKey}" on asset ${def.assetId} failed; continuing the ` +
          `sweep: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  if (toWrite.length > 0) {
    await deps.writer.writeValues(toWrite);
  }
}

export interface CalcSchedulerLoopDeps extends CalcSchedulerDeps {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  baseTickMs: number;
}

/**
 * The self-scheduling loop itself (ADR 0037 decision 7): `for (;;)`, do the
 * sweep, **then** sleep — never `setInterval`, which would let a slow sweep
 * overlap the next tick. `apps/ingest/src/host/supervisor.ts`'s
 * `runPollLoop` is the precedent this mirrors. `sleep`/`now` are injected —
 * `TelemetryListenerDeps.sleep`'s reason applies unchanged: tests must not
 * wait out real ticks.
 *
 * The loop owns the cyclic set the transition log compares against, one per
 * loop, so a cycle that persists is logged once for as long as it persists.
 */
export async function runSchedulerLoop(
  deps: CalcSchedulerLoopDeps,
  lastRunMs: Map<string, number>,
  signal: AbortSignal,
): Promise<void> {
  const previousCyclic = new Set<NodeId>();
  for (;;) {
    if (signal.aborted) {
      return;
    }
    try {
      await runScheduledSweep(deps, lastRunMs, deps.now(), previousCyclic);
    } catch (err) {
      deps.logger.warn(`calc scheduler: sweep failed: ${(err as Error)?.message ?? err}`);
    }
    if (signal.aborted) {
      return;
    }
    await deps.sleep(deps.baseTickMs, signal);
  }
}

/**
 * Scheduled calc host (ADR 0037 decision 7) — a thin wiring shell over
 * {@link runSchedulerLoop}. Starts with the API process; `onModuleDestroy`
 * aborts the loop's `sleep` immediately rather than waiting out the current
 * tick, the same shutdown discipline `TelemetryNotifyService` uses.
 */
@Injectable()
export class CalcSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CalcSchedulerService.name);
  private readonly lastRunMs = new Map<string, number>();
  private readonly abortController = new AbortController();

  constructor(
    private readonly definitions: CalcDefinitionsService,
    private readonly inputs: CalcInputsService,
    private readonly scope: CalcScopeService,
    private readonly writer: CalcWriteService,
    private readonly metrics: MetricsService,
    private readonly status: CalcStatusRegistry,
  ) {}

  onModuleInit(): void {
    const deps: CalcSchedulerLoopDeps = {
      definitions: this.definitions,
      inputs: this.inputs,
      scope: this.scope,
      writer: this.writer,
      metrics: this.metrics,
      status: this.status,
      logger: this.logger,
      sleep,
      now: () => Date.now(),
      baseTickMs: BASE_TICK_MS,
    };
    void runSchedulerLoop(deps, this.lastRunMs, this.abortController.signal).catch((err: unknown) => {
      this.logger.warn(`calc scheduler loop exited: ${(err as Error)?.message ?? err}`);
    });
  }

  onModuleDestroy(): void {
    this.abortController.abort();
  }
}
