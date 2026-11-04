import { expect } from "vitest";

import { CALC_DIALECT, parseFormula } from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import type { CalcDefinition } from "../calc/calc-definition";
import type { CalcWriteInput } from "../calc/calc-write.service";
import type { BmsTx } from "../database/tenant-context";
import { BACKFILL_MAX_SAMPLE_ROWS, bucketsPerChunk } from "./calc-backfill-plan";
import type { ClaimedRun } from "./calc-backfill-run-store";
import {
  CalcBackfillFailedError,
  claimBackfill,
  NO_ACTIVE_DEFINITION,
  walkBackfill,
  type CalcBackfillDeps,
} from "./calc-backfill.service";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill walk against fakes. No
 * database: the store, the reads and the writer record what the walk decides;
 * the definition is a real parse of `{a} * 2`. `calc-backfill.integration`
 * carries the database half (a stored value survives; the rollup has the
 * bucket).
 */

const T0 = Date.UTC(2026, 9, 1);
const MINUTE = 60_000;
const ORG = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const POINT_ID = "33333333-3333-4333-8333-333333333333";
const TX = {} as BmsTx;

function definition(overrides: Partial<CalcDefinition> = {}): CalcDefinition {
  const parsed = parseFormula("{a} * 2", { dialect: CALC_DIALECT });
  if (!parsed.ok) throw new Error("fixture formula must parse");
  return {
    templatePointId: POINT_ID,
    assetId: "asset-1",
    pointKey: "DERIVED",
    ast: parsed.ast,
    refs: parsed.refs,
    trigger: "scheduled",
    intervalSeconds: 60,
    maxInputAgeSeconds: 999_999,
    dialect: CALC_DIALECT,
    crossRefs: [],
    paramRefs: [],
    windowReads: [],
    minCoverageRatio: null,
    ...overrides,
  };
}

function claimed(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    runId: RUN_ID,
    organizationId: ORG,
    assetPointId: POINT_ID,
    assetId: "asset-1",
    pointKey: "DERIVED",
    fromMs: T0,
    toMs: T0 + 1200 * MINUTE,
    doneThroughMs: null,
    writtenRows: 0,
    ...overrides,
  };
}

type Recorder = {
  readonly deps: CalcBackfillDeps;
  /** "write" and "progress", in the order they happened. */
  readonly events: string[];
  readonly writes: CalcWriteInput[][];
  readonly progress: { doneThrough: Date; writtenRows: number }[];
  readonly finishes: unknown[];
  readonly refreshes: [Date, Date][];
  /** The options of every `writeValues` call. */
  readonly writeOptions: unknown[];
  /** The arguments of every `getAllDefinitionsFresh` call. */
  readonly definitionReads: unknown[];
  /** Each `readSamples` call: how many pairs, how many instants. */
  readonly sampleReads: { pairs: number; instants: number }[];
  /** Each `readInputTimes` call's `limit`. */
  readonly inputTimeLimits: number[];
};

type FakeOptions = {
  def?: CalcDefinition | null;
  /** What `current` answers before each later chunk; `"running"` by default. */
  current?: string | null;
  /** The one sample of `a` every read returns. */
  sample?: { timeMs: number; value: number };
  writeThrows?: Error;
  inputTimes?: number[];
  refreshThrows?: Error;
};

function fakes(options: FakeOptions = {}): Recorder {
  const events: string[] = [];
  const writes: CalcWriteInput[][] = [];
  const progress: { doneThrough: Date; writtenRows: number }[] = [];
  const finishes: unknown[] = [];
  const refreshes: [Date, Date][] = [];
  const writeOptions: unknown[] = [];
  const definitionReads: unknown[] = [];
  const sampleReads: { pairs: number; instants: number }[] = [];
  const inputTimeLimits: number[] = [];
  const def = options.def === undefined ? definition() : options.def;
  const sample = options.sample ?? { timeMs: T0 - 1000, value: 5 };
  const deps: CalcBackfillDeps = {
    store: {
      claim: async () => claimed(),
      current: async () => (options.current === undefined ? "running" : options.current),
      progress: async (_org, _run, doneThrough, writtenRows) => {
        events.push("progress");
        progress.push({ doneThrough, writtenRows });
      },
      finish: async (_org, _run, outcome) => {
        finishes.push(outcome);
      },
    },
    definitions: {
      getAllDefinitionsFresh: async (...args) => {
        definitionReads.push(...args);
        return def === null ? [] : [def];
      },
    },
    scope: { resolveMembership: async () => ({ qualified: new Map(), members: new Map() }) },
    parameters: { resolveSeriesForAssets: async () => new Map() },
    windows: { resolveReads: async () => new Map() },
    reads: {
      readSamples: async (pairs, instants) => {
        sampleReads.push({ pairs: pairs.length, instants: instants.length });
        return new Map([[inputKey("asset-1", "a"), [sample]]]);
      },
      readInputTimes: async (_asset, _keys, fromMs, _toMs, limit) => {
        inputTimeLimits.push(limit);
        return (options.inputTimes ?? []).filter((t) => t >= fromMs).slice(0, limit);
      },
      refreshAggregates: async (from, to) => {
        if (options.refreshThrows) throw options.refreshThrows;
        refreshes.push([from, to]);
      },
    },
    writer: {
      writeValues: async (rows, passed) => {
        if (options.writeThrows) throw options.writeThrows;
        writeOptions.push(passed);
        events.push("write");
        writes.push([...rows]);
        return { written: rows.length, assetPointsCreated: 0 };
      },
    },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  };
  return { deps, events, writes, progress, finishes, refreshes, writeOptions, definitionReads, sampleReads, inputTimeLimits };
}

/** A run that is not claimable (`claim` → null) hands back no continuation. */
export async function aRunThatIsNotQueuedReturnsNoContinuation(): Promise<void> {
  const { deps } = fakes();
  const result = await claimBackfill({ ...deps, store: { ...deps.store, claim: async () => null } }, payload(), TX);
  expect(result).toBeUndefined();
}

/** A job whose payload names another point than its run throws, so the claim rolls back. */
export async function aPayloadNamingAnotherPointIsRefused(): Promise<void> {
  const { deps } = fakes();
  await expect(claimBackfill(deps, { ...payload(), assetPointId: RUN_ID }, TX)).rejects.toThrow(/different point/);
}

function payload() {
  return { organizationId: ORG, runId: RUN_ID, assetPointId: POINT_ID };
}

/** No chunk's write holds more than 500 rows (1,200 buckets → 500, 500, 200). */
export async function noWriteExceeds500Rows(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.writes.map((w) => w.length)).toEqual([500, 500, 200]);
}

/** Progress lags the write: every progress write follows its chunk's value write. */
export async function progressLagsTheWrite(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.events).toEqual(["write", "progress", "write", "progress", "write", "progress"]);
}

/** `done_through` after the first chunk is that chunk's last bucket. */
export async function progressNamesTheChunksLastBucket(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.progress[0]?.doneThrough.getTime()).toBe(T0 + 499 * MINUTE);
}

/** Every backfilled row is the formula's value at its bucket: `{a} * 2` with `a = 5`. */
export async function everyRowCarriesTheFormulasValue(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(new Set(r.writes.flat().map((row) => row.value))).toEqual(new Set([10]));
}

/** A run deleted mid-walk (the point was removed) stops at the next chunk. */
export async function aDeletedRunStopsAtTheNextChunk(): Promise<void> {
  const r = fakes({ current: null });
  await walkBackfill(r.deps, claimed());
  expect(r.writes).toHaveLength(1);
}

/** A stopped walk writes no terminal status — the row is gone or someone else's. */
export async function aStoppedWalkDoesNotFinishTheRun(): Promise<void> {
  const r = fakes({ current: null });
  await walkBackfill(r.deps, claimed());
  expect(r.finishes).toEqual([]);
}

/** The run's whole window is refreshed once, after the last chunk: `(from, to)`. */
export async function theWindowIsRefreshedOnceFromTo(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.refreshes.map(([from, to]) => [from.getTime(), to.getTime()])).toEqual([[T0, T0 + 1200 * MINUTE]]);
}

/** A walk that reaches the end marks the run `done`. */
export async function aFinishedWalkMarksTheRunDone(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.finishes).toEqual([{ status: "done" }]);
}

/** A retry resumes after `done_through`: the first row written is the next bucket. */
export async function aRetryResumesAfterDoneThrough(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed({ doneThroughMs: T0 + 599 * MINUTE }));
  expect(r.writes[0]?.[0]?.time.getTime()).toBe(T0 + 600 * MINUTE);
}

/** An instant whose input is stale writes nothing (`{a}` at T0, budget 120 s → buckets T0..T0+2min only). */
export async function aStaleInstantWritesNothing(): Promise<void> {
  const r = fakes({ def: definition({ maxInputAgeSeconds: 120 }), sample: { timeMs: T0, value: 5 } });
  await walkBackfill(r.deps, claimed({ toMs: T0 + 5 * MINUTE }));
  expect(r.writes.flat().map((row) => (row.time.getTime() - T0) / MINUTE)).toEqual([0, 1, 2]);
}

const failure = Object.assign(new Error("relation telemetry.point_values: secret detail"), { name: "DatabaseError" });

/** A throw marks the run `failed` with the error's name only. */
export async function aThrowFailsTheRunByErrorName(): Promise<void> {
  const r = fakes({ writeThrows: failure });
  await walkBackfill(r.deps, claimed()).catch(() => undefined);
  expect(r.finishes).toEqual([{ status: "failed", error: "DatabaseError" }]);
}

/** …and rethrows, so BullMQ retries, with a message that carries no text of the original. */
export async function aThrowIsRethrownWithoutItsMessage(): Promise<void> {
  const r = fakes({ writeThrows: failure });
  const thrown = await walkBackfill(r.deps, claimed()).then(
    () => null,
    (err: unknown) => err,
  );
  expect(thrown instanceof CalcBackfillFailedError && !thrown.message.includes("secret")).toBe(true);
}

/** A point with no active definition fails with the fixed sentence and writes nothing. */
export async function aPointWithNoDefinitionFails(): Promise<void> {
  const r = fakes({ def: null });
  await walkBackfill(r.deps, claimed());
  expect(r.finishes).toEqual([{ status: "failed", error: NO_ACTIVE_DEFINITION }]);
}

/** A streaming point writes at its inputs' stored times. */
export async function aStreamingPointWritesAtItsInputTimes(): Promise<void> {
  const times = [T0 + 7_000, T0 + 19_000, T0 + 31_000];
  const r = fakes({ def: definition({ trigger: "streaming", intervalSeconds: null }), inputTimes: times });
  await walkBackfill(r.deps, claimed());
  expect(r.writes.flat().map((row) => row.time.getTime())).toEqual(times);
}

// ---- PR 5 review ----------------------------------------------------------

/** Every chunk is written with `{ notify: false }`: history must never reach the live consumers of `bms_telemetry`. */
export async function everyChunkIsWrittenWithoutNotify(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.writeOptions).toEqual([{ notify: false }, { notify: false }, { notify: false }]);
}

/** The walk reads its definition without moving the worker's `bms_api_calc_active_formulas`. */
export async function theDefinitionReadLeavesTheGaugeAlone(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed());
  expect(r.definitionReads).toEqual([{ reportGauge: false }]);
}

const refreshFailure = Object.assign(new Error("could not refresh: secret detail"), { name: "RefreshError" });

/** A failed final refresh fails the run by the error's name — decision 7's refresh is a guarantee, not a hope. */
export async function aFailedFinalRefreshFailsTheRun(): Promise<void> {
  const r = fakes({ refreshThrows: refreshFailure });
  await walkBackfill(r.deps, claimed()).catch(() => undefined);
  expect(r.finishes).toEqual([{ status: "failed", error: "RefreshError" }]);
}

/** …and rethrows, so BullMQ retries it. */
export async function aFailedFinalRefreshIsRethrown(): Promise<void> {
  const r = fakes({ refreshThrows: refreshFailure });
  const thrown = await walkBackfill(r.deps, claimed()).then(
    () => null,
    (err: unknown) => err,
  );
  expect(thrown).toBeInstanceOf(CalcBackfillFailedError);
}

/** …leaving `done_through` at the last chunk's bucket, so the retry has nothing left to walk. */
export async function aFailedFinalRefreshLeavesDoneThroughAtTheLastBucket(): Promise<void> {
  const r = fakes({ refreshThrows: refreshFailure });
  await walkBackfill(r.deps, claimed()).catch(() => undefined);
  expect(r.progress.at(-1)?.doneThrough.getTime()).toBe(T0 + 1199 * MINUTE);
}

/** The retry of a run whose chunks were all walked writes nothing and only repeats the refresh. */
export async function aRetryAfterTheLastChunkOnlyRefreshes(): Promise<void> {
  const r = fakes();
  await walkBackfill(r.deps, claimed({ doneThroughMs: T0 + 1199 * MINUTE }));
  expect({ writes: r.writes.length, refreshes: r.refreshes.length, finishes: r.finishes }).toEqual({
    writes: 0,
    refreshes: 1,
    finishes: [{ status: "done" }],
  });
}

/** A definition over 300 input pairs. Its formula still reads `{a}` only; `refs` is what the walk reads. */
function wideDefinition(trigger: "scheduled" | "streaming" = "scheduled"): CalcDefinition {
  return definition({
    refs: Array.from({ length: 300 }, (_, i) => `k${i}`),
    trigger,
    intervalSeconds: trigger === "scheduled" ? 60 : null,
  });
}

/** Many inputs shrink the chunk: 1,200 buckets over 300 pairs read 333, 333, 333, 201 at a time. */
export async function manyInputsPageTheSampleRead(): Promise<void> {
  const r = fakes({ def: wideDefinition() });
  await walkBackfill(r.deps, claimed());
  const size = bucketsPerChunk(300);
  expect(r.sampleReads.map((read) => read.instants)).toEqual([size, size, size, 1200 - 3 * size]);
}

/** No sample read asks for more than the cap: pairs × instants ≤ `BACKFILL_MAX_SAMPLE_ROWS`. */
export async function noSampleReadExceedsTheCap(): Promise<void> {
  const r = fakes({ def: wideDefinition() });
  await walkBackfill(r.deps, claimed());
  expect(Math.max(...r.sampleReads.map((read) => read.pairs * read.instants))).toBeLessThanOrEqual(
    BACKFILL_MAX_SAMPLE_ROWS,
  );
}

/** A streaming point over many inputs asks for at most the shrunk chunk of input times. */
export async function aWideStreamingPointPagesItsInputTimes(): Promise<void> {
  const r = fakes({ def: wideDefinition("streaming"), inputTimes: [T0 + 7_000] });
  await walkBackfill(r.deps, claimed());
  expect(r.inputTimeLimits).toEqual([bucketsPerChunk(300)]);
}
