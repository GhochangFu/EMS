import { expect } from "vitest";

import { CALC_DIALECT, parseFormula } from "@bms/shared";

import { inputKey } from "../calc/calc-batch";
import type { CalcDefinition } from "../calc/calc-definition";
import type { CalcWriteInput } from "../calc/calc-write.service";
import type { BmsTx } from "../database/tenant-context";
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
};

type FakeOptions = {
  def?: CalcDefinition | null;
  /** What `current` answers before each later chunk; `"running"` by default. */
  current?: string | null;
  /** The one sample of `a` every read returns. */
  sample?: { timeMs: number; value: number };
  writeThrows?: Error;
  inputTimes?: number[];
};

function fakes(options: FakeOptions = {}): Recorder {
  const events: string[] = [];
  const writes: CalcWriteInput[][] = [];
  const progress: { doneThrough: Date; writtenRows: number }[] = [];
  const finishes: unknown[] = [];
  const refreshes: [Date, Date][] = [];
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
    definitions: { getAllDefinitionsFresh: async () => (def === null ? [] : [def]) },
    scope: { resolveMembership: async () => ({ qualified: new Map(), members: new Map() }) },
    parameters: { resolveSeriesForAssets: async () => new Map() },
    windows: { resolveReads: async () => new Map() },
    reads: {
      readSamples: async () => new Map([[inputKey("asset-1", "a"), [sample]]]),
      readInputTimes: async (_asset, _keys, fromMs) => (options.inputTimes ?? []).filter((t) => t >= fromMs),
      refreshAggregates: async (from, to) => {
        refreshes.push([from, to]);
      },
    },
    writer: {
      writeValues: async (rows) => {
        if (options.writeThrows) throw options.writeThrows;
        events.push("write");
        writes.push([...rows]);
        return { written: rows.length, assetPointsCreated: 0 };
      },
    },
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  };
  return { deps, events, writes, progress, finishes, refreshes };
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
