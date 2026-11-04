import { Injectable, Logger } from "@nestjs/common";

import { crossRefKey, evaluate } from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import type { CalcDefinition } from "../calc/calc-definition";
import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import type { Membership } from "../calc/calc-graph";
import { assembleInputs, NO_OVERLAY, planWindowRequests } from "../calc/calc-input-assembly";
import type { ParameterSeriesRow } from "../calc/calc-parameter-series";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { CalcScopeService } from "../calc/calc-scope.service";
import { windowEndMs } from "../calc/calc-window-plan";
import { CalcWindowsService, type WindowReadResult } from "../calc/calc-windows.service";
import { CalcWriteService, type CalcWriteInput } from "../calc/calc-write.service";
import type { BmsTx } from "../database/tenant-context";
import type { calcBackfillQueue } from "../queue/calc-backfill";
import type { ProcessorContinuation } from "../queue/queue-processor";
import type { PayloadOf } from "../queue/queue-registry";
import { asOfIndex, asOfInputs, bucketGrid, bucketsPerChunk, chunk, parametersAt } from "./calc-backfill-plan";
import { CalcBackfillReads, type BackfillPair } from "./calc-backfill-reads";
import { CalcBackfillRunStore, type ClaimedRun } from "./calc-backfill-run-store";

export type CalcBackfillPayload = PayloadOf<typeof calcBackfillQueue>;

/** The run's `error` when the point no longer has an active formula to backfill. */
export const NO_ACTIVE_DEFINITION = "the point has no active definition";

/** What the walk reads and writes — the class's providers, as `Pick`s so the spec can fake each. */
export interface CalcBackfillDeps {
  store: Pick<CalcBackfillRunStore, "claim" | "current" | "progress" | "finish">;
  definitions: Pick<CalcDefinitionsService, "getAllDefinitionsFresh">;
  scope: Pick<CalcScopeService, "resolveMembership">;
  parameters: Pick<CalcParametersService, "resolveSeriesForAssets">;
  windows: Pick<CalcWindowsService, "resolveReads">;
  reads: Pick<CalcBackfillReads, "readSamples" | "readInputTimes" | "refreshAggregates">;
  writer: Pick<CalcWriteService, "writeValues">;
  logger: Pick<Logger, "log" | "warn" | "error">;
}

/**
 * The error a failed walk rethrows so BullMQ retries the job. Its message is
 * the original error's **name** only: a rejection's message lands in Redis as
 * the job's `failedReason`, and a driver error's message can carry SQL text
 * (§9.6, the discovery job's L1).
 */
export class CalcBackfillFailedError extends Error {
  override readonly name = "CalcBackfillFailedError";
  constructor(cause: string) {
    super(`calc backfill failed: ${cause}`);
  }
}

/** An error's `name` only — never its message. */
function errorName(err: unknown): string {
  return typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : "unknown";
}

type Tally = Map<string, number>;
type WalkState = { written: number; chunks: number; readonly refused: Tally };

const EMPTY_SERIES: ReadonlyMap<string, readonly ParameterSeriesRow[]> = new Map();
const EMPTY_WINDOWS: ReadonlyMap<string, WindowReadResult> = new Map();

/**
 * Phase A, on `runProcessor`'s tenant transaction: claim the run. A run that
 * is not claimable (gone, live `running`, `done`, failed for a reason no
 * retry mends)
 * returns no continuation — the job did nothing and completes. The walk is
 * the continuation, so it runs after the claim committed and holds no tenant
 * backend while it computes.
 */
export async function claimBackfill(
  deps: CalcBackfillDeps,
  payload: CalcBackfillPayload,
  tx: BmsTx,
): Promise<void | ProcessorContinuation> {
  const run = await deps.store.claim(tx, payload.runId);
  if (run === null) {
    deps.logger.log(`calc-backfill skipped: run not claimable runId=${payload.runId}`);
    return;
  }
  if (run.assetPointId !== payload.assetPointId) {
    // Throwing rolls the claim back: a job that names another point than its
    // run is not this producer's, and nothing it says is acted on.
    throw new Error("calc backfill: the job names a different point than its run");
  }
  return { afterCommit: () => walkBackfill(deps, run) };
}

/**
 * Phase B — the walk (ADR 0109 decision 7), after the claim committed.
 *
 * 1. The point's definition, read past the cache; none → `failed` with
 *    {@link NO_ACTIVE_DEFINITION}, and the job completes.
 * 2. Membership, **once**: a backfill of an aggregate uses today's members at
 *    every past bucket (owner ruling 3, an accepted limit — membership is
 *    configuration, not an input, and its history is not stored).
 * 3. Chunks of at most `bucketsPerChunk(pairs)` instants — 500, fewer when
 *    the definition reads so many input pairs that `pairs × instants` would
 *    pass `BACKFILL_MAX_SAMPLE_ROWS` (100,000): **the bound is on the rows a
 *    chunk reads**, not only on its buckets, because each read returns at most
 *    one sample per (pair, instant). A scheduled point walks its own bucket
 *    grid; a streaming point walks the stored times of its inputs. Each chunk
 *    is one bounded read, one evaluation per instant through the live
 *    engine's `assembleInputs` (as of that instant), one `writeValues` with
 *    `{ notify: false }` — history never reaches `bms_telemetry`'s live
 *    consumers (the alarm engine, the streaming host, the sockets) — which
 *    never overwrites, so a stored value survives, and then the progress
 *    write. `progress` also bumps `updated_at`, the heartbeat the run store's
 *    stale bound reads. **Progress follows the write**, so
 *    `done_through` never claims a bucket that is not stored; a retry resumes
 *    there. Before each later chunk the run is re-read, and the walk stops
 *    when it is gone (the point was deleted, the run cascaded) or no longer
 *    `running`.
 * 4. One `refreshAggregates(from, to)` over the run's whole window, then
 *    `done`. `writeValues` already refreshes each chunk's span, but only as a
 *    warning-on-failure; this call is decision 7's guarantee, so **its
 *    failure fails the run** like any other throw. `done_through` is then the
 *    last bucket, so BullMQ's retry walks no chunk and repeats only the
 *    refresh — the run is `done` only once the rollups hold the history.
 *
 * A refusal at an instant (stale, missing, unset, …) writes nothing there and
 * is tallied; the tally is logged at the end, never counted in
 * `bms_api_calc_skipped_total`, which is the sweep's. Any throw marks the run
 * `failed` with the error's name and rethrows {@link CalcBackfillFailedError}.
 * If that `failed` write itself throws, the row stays `running` with its
 * last heartbeat, and the retry re-claims it once the run store's stale bound
 * (`BACKFILL_STALE_MINUTES`) has passed — resuming at `done_through`.
 * Logs carry ids and counts only — never a formula or a value.
 */
export async function walkBackfill(deps: CalcBackfillDeps, run: ClaimedRun): Promise<void> {
  const ids = `runId=${run.runId} assetPointId=${run.assetPointId}`;
  try {
    // `reportGauge: false`: this read runs on the worker, whose registry must
    // not carry a second, frozen `bms_api_calc_active_formulas` series.
    const def = (await deps.definitions.getAllDefinitionsFresh({ reportGauge: false })).find(
      (candidate) => candidate.assetId === run.assetId && candidate.pointKey === run.pointKey,
    );
    if (def === undefined || (def.trigger === "scheduled" && !(def.intervalSeconds && def.intervalSeconds > 0))) {
      await deps.store.finish(run.organizationId, run.runId, { status: "failed", error: NO_ACTIVE_DEFINITION });
      deps.logger.log(`calc-backfill failed: no active definition ${ids}`);
      return;
    }
    const membership = await deps.scope.resolveMembership([def]);
    const walk: Walk = { def, membership, pairs: inputPairs(def, membership) };
    const state: WalkState = { written: run.writtenRows, chunks: 0, refused: new Map() };
    const finished =
      def.trigger === "scheduled" ? await walkScheduled(deps, run, walk, state) : await walkStreaming(deps, run, walk, state);
    if (!finished) {
      deps.logger.log(`calc-backfill stopped: the run is gone or no longer running ${ids} chunks=${state.chunks}`);
      return;
    }
    await deps.reads.refreshAggregates(new Date(run.fromMs), new Date(run.toMs));
    await deps.store.finish(run.organizationId, run.runId, { status: "done" });
    deps.logger.log(
      `calc-backfill done ${ids} chunks=${state.chunks} written=${state.written} refused=${tallyText(state.refused)}`,
    );
  } catch (err) {
    const name = errorName(err);
    try {
      await deps.store.finish(run.organizationId, run.runId, { status: "failed", error: name });
    } catch (finishErr) {
      deps.logger.error(`calc-backfill failure write failed: ${errorName(finishErr)} ${ids}`);
    }
    deps.logger.error(`calc-backfill failed: ${name} ${ids}`);
    throw new CalcBackfillFailedError(name);
  }
}

function tallyText(tally: Tally): string {
  return [...tally.entries()].map(([reason, n]) => `${reason}:${n}`).join(",") || "none";
}

/** Every pair the definition reads: its own local keys and, through membership, its cross references. */
function inputPairs(def: CalcDefinition, membership: Membership): BackfillPair[] {
  const pairs = new Map<string, BackfillPair>();
  const add = (assetId: string, pointKey: string) => pairs.set(inputKey(assetId, pointKey), { assetId, pointKey });
  for (const ref of def.refs) add(def.assetId, ref);
  const qualified = membership.qualified.get(def.assetId);
  const members = membership.members.get(def.assetId);
  for (const ref of def.crossRefs) {
    if (ref.kind === "qref") {
      const assetId = qualified?.get(ref.assetCode);
      if (assetId) add(assetId, ref.pointKey);
    } else {
      for (const pair of members?.get(crossRefKey(ref)) ?? []) add(pair.assetId, pair.pointKey);
    }
  }
  return [...pairs.values()];
}

/** What every chunk of one walk shares: the definition, today's membership, and the input pairs they imply. */
type Walk = { readonly def: CalcDefinition; readonly membership: Membership; readonly pairs: readonly BackfillPair[] };

/** True while the run row still exists and is `running`. */
async function stillRunning(deps: CalcBackfillDeps, run: ClaimedRun): Promise<boolean> {
  return (await deps.store.current(run.organizationId, run.runId)) === "running";
}

/** One chunk's evaluations, write and progress. `instants` are ascending; the write time of each is the instant. */
async function runChunk(
  deps: CalcBackfillDeps,
  run: ClaimedRun,
  { def, membership, pairs }: Walk,
  instants: readonly number[],
  state: WalkState,
): Promise<void> {
  const first = instants[0] as number;
  const last = instants[instants.length - 1] as number;
  const interval = def.intervalSeconds ?? 0;
  const index = asOfIndex(await deps.reads.readSamples(pairs, instants, def.maxInputAgeSeconds));
  const series =
    def.paramRefs.length > 0
      ? await deps.parameters.resolveSeriesForAssets(
          def.paramRefs.map((key) => ({ assetId: def.assetId, key })),
          new Date(first),
          new Date(last),
        )
      : EMPTY_SERIES;
  const windows =
    def.windowReads.length > 0 && interval > 0
      ? await deps.windows.resolveReads(instants.flatMap((t) => planWindowRequests(def, membership, windowEndMs(t, interval))))
      : EMPTY_WINDOWS;

  const rows: CalcWriteInput[] = [];
  for (const t of instants) {
    const assembled = await assembleInputs(
      { inputs: asOfInputs(index, t) },
      def,
      t,
      membership,
      NO_OVERLAY,
      parametersAt(series, t),
      windows,
      interval > 0 ? windowEndMs(t, interval) : t,
    );
    if (!assembled.ok) {
      state.refused.set(assembled.reason, (state.refused.get(assembled.reason) ?? 0) + 1);
      continue;
    }
    const result = evaluate(def.ast, assembled.inputs, assembled.crossInputs, assembled.params, assembled.windowValues);
    if (!result.ok) {
      state.refused.set("non_finite", (state.refused.get("non_finite") ?? 0) + 1);
      continue;
    }
    rows.push({ assetId: def.assetId, pointKey: def.pointKey, time: new Date(t), value: result.value });
  }

  const { written } = await deps.writer.writeValues(rows, { notify: false });
  state.written += written;
  state.chunks += 1;
  await deps.store.progress(run.organizationId, run.runId, new Date(last), state.written);
}

/** A scheduled point: its bucket grid over the run's window, from `done_through` on a retry. Returns `false` when stopped. */
async function walkScheduled(deps: CalcBackfillDeps, run: ClaimedRun, walk: Walk, state: WalkState): Promise<boolean> {
  const startMs = run.doneThroughMs === null ? run.fromMs : run.doneThroughMs + 1;
  const grid = bucketGrid(startMs, run.toMs, walk.def.intervalSeconds as number);
  for (const [i, buckets] of chunk(grid, bucketsPerChunk(walk.pairs.length)).entries()) {
    if (i > 0 && !(await stillRunning(deps, run))) {
      return false;
    }
    await runChunk(deps, run, walk, buckets, state);
  }
  return true;
}

/**
 * A streaming point (decision 7's last sentence): its instants are the
 * distinct stored times of its inputs in the window, read a chunk at a time,
 * each evaluated with its inputs as of that time under `maxInputAgeSeconds`
 * and written at that time — the streaming host's own rule (the newest input
 * used, which is the instant itself). Returns `false` when stopped.
 */
async function walkStreaming(deps: CalcBackfillDeps, run: ClaimedRun, walk: Walk, state: WalkState): Promise<boolean> {
  const size = bucketsPerChunk(walk.pairs.length);
  let fromMs = run.doneThroughMs === null ? run.fromMs : run.doneThroughMs + 1;
  for (let i = 0; ; i += 1) {
    if (i > 0 && !(await stillRunning(deps, run))) {
      return false;
    }
    const instants = await deps.reads.readInputTimes(walk.def.assetId, walk.def.refs, fromMs, run.toMs, size);
    if (instants.length === 0) {
      return true;
    }
    await runChunk(deps, run, walk, instants, state);
    fromMs = (instants[instants.length - 1] as number) + 1;
    if (instants.length < size) {
      return true;
    }
  }
}

/**
 * `F4.311` PR 5a — the `calc-backfill` processor body (ADR 0109 decision 7),
 * a thin shell over {@link claimBackfill} and {@link walkBackfill}. Lives in
 * the worker leaf `CalcBackfillModule`; never in `CalcModule`, whose import of
 * the telemetry loop would start the API's loops on the worker.
 */
@Injectable()
export class CalcBackfillService {
  private readonly deps: CalcBackfillDeps;

  constructor(
    store: CalcBackfillRunStore,
    definitions: CalcDefinitionsService,
    scope: CalcScopeService,
    parameters: CalcParametersService,
    windows: CalcWindowsService,
    reads: CalcBackfillReads,
    writer: CalcWriteService,
  ) {
    this.deps = { store, definitions, scope, parameters, windows, reads, writer, logger: new Logger("CalcBackfill") };
  }

  run(payload: CalcBackfillPayload, tx: BmsTx): Promise<void | ProcessorContinuation> {
    return claimBackfill(this.deps, payload, tx);
  }
}
