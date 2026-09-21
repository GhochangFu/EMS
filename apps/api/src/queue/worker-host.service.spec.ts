import "reflect-metadata";

import type { BmsDb } from "@bms/db";
import type { RuleSweepSummary } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import type { MetricsService } from "../observability/metrics.service";
import type { ReportDispatchService, ReportDispatchSummary } from "../reports/report-dispatch.service";
import type { RenderOutcome, ReportRenderService } from "../reports/report-render.service";
import type { RuleSweepService } from "../rules/rule-sweep.service";
import type { ProcessorContinuation, ProcessorDbs, ProcessorHandler } from "./queue-processor";
import type { QueueClient, QueueHandle } from "./queue-registry";
import { ALL_QUEUES } from "./queues";
import { reportsDispatchQueue } from "./reports-dispatch";
import { reportsRenderQueue } from "./reports-render";
import { ruleSweepKey, rulesSweepQueue } from "./rules-sweep";
import { WorkerHostService } from "./worker-host.service";

/**
 * F4.24 (ADR 0063 decision 6) and F3.11 (ADR 0064 decisions 2, 6; ADR 0063
 * decision 12) — what `WorkerHostService.onModuleInit` registers, and with
 * which pools.
 *
 * `database/fleet-read-wiring.spec.ts` pins which token lands in which
 * constructor slot. It cannot see the next line: `runProcessor(…, {
 * tenantDb: this.tenantDb, fleetDb: this.fleetDb }, …)`. Swap that literal
 * and the slot pins stay green while every tenant job runs on the
 * BYPASSRLS pool with a GUC nobody reads. This spec constructs the service
 * directly with two sentinel pools and reads what `runProcessor` received —
 * once per registration, selected by the declaration's `name`, because the
 * host now registers more than one.
 *
 * Three more things only this spec can see, since no test boots
 * `WorkerModule` (Amendment 1):
 *
 * - **decision 12 as a set equality** — the names of the registrations
 *   `startQueueWorkers` was handed equal the names in `ALL_QUEUES`. Read at
 *   `startQueueWorkers`, not at `runProcessor`: a registration that is
 *   wrapped and then left out of the array gets no `Worker`, and only the
 *   array says which queues get one. A declared queue with no consumer grows
 *   silently; a consumer with no declaration has no client handle.
 * - **the sweep's cadence is the configured one** — `upsertSchedule` received
 *   `RULE_SWEEP_SCHEDULER_ID` and `config.ruleSweepIntervalMs`, which the fake
 *   sets to a value no constant in the tree equals.
 * - **the sweep handler's two effects** — invoked with `{ db: FLEET_SENTINEL }`
 *   (what `runProcessor` builds for a `fleet` queue), it hands that handle to
 *   `RuleSweepService.run` and writes `JSON.stringify(summary)` under
 *   `ruleSweepKey(prefix)`. The write is observed at the fake handle's
 *   `redis.set`, so the real `writeKey` → `queueStore` path runs.
 *
 * **`F3.5b` (ADR 0071 decision 8; plan R-5, R-17) appended slots 6 and 7**
 * — `ReportDispatchService`, `ReportRenderService` — and two registrations:
 *
 * - **the dispatch schedule's cadence is the configured one** —
 *   `upsertSchedule` received `REPORT_DISPATCH_SCHEDULER_ID` and
 *   `config.reportDispatchIntervalMs`, a second sentinel distinct from the
 *   sweep's so the two intervals cannot be crossed.
 * - **the dispatch handler ticks on the handle it was given** — invoked with
 *   `{ db: FLEET_SENTINEL }`, it hands that handle to
 *   `ReportDispatchService.tick`.
 * - **the render handler returns a continuation that finishes the outcome**
 *   — invoked with `{ tx: TX_SENTINEL }`, it hands the transaction to
 *   `ReportRenderService.render` and resolves `{ afterCommit }`; calling
 *   `afterCommit()` hands `finish` the very outcome `render` returned
 *   (identity, not shape — a continuation that re-renders or finishes a
 *   copy is the defect). Drop the `return` and the row reddens on a `void`.
 *
 * **Which row holds which registration.** The set equality reads names
 * only, and `startQueueWorkers` builds each `Worker` from its own
 * registration's `decl.name` — so swapping `dispatch` and `render` in the
 * array it is handed changes no behaviour and reddens nothing here, by
 * design (measured at U9: the plan expected the handler-shape row to
 * redden; it cannot, because `registrationOf` reads `runProcessor`'s calls,
 * not the array). What the two handler rows hold is that the handler
 * registered against `reportsRenderQueue` is the render body and the one
 * against `reportsDispatchQueue` is the tick: swap the two *handlers*
 * between the `runProcessor` calls and both rows redden.
 *
 * The `.test.ts` wrapper `vi.mock`s `./queue-processor`, `./queue-registry`'s
 * `upsertSchedule` and `./worker-host` so `onModuleInit` runs without Redis,
 * and hands the recorded calls across. One claim per function — `assert`
 * throws, so a bundled pair would only ever report the first.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Two distinct sentinels so `tenantDb === fleetDb` cannot pass by accident. */
export const TENANT_SENTINEL = { pool: "tenant-sentinel" } as unknown as BmsDb;
export const FLEET_SENTINEL = { pool: "fleet-sentinel" } as unknown as BmsDb;

/** What the fake `RuleSweepService.run` returns; the values are arbitrary and distinct. */
export const SUMMARY: RuleSweepSummary = {
  finishedAt: "2026-09-11T10:20:30.000Z",
  evaluated: 7,
  raised: 2,
  durationMs: 345,
};

/** A value no constant in the tree equals, so a hard-coded interval cannot pass by coincidence. */
export const CONFIGURED_SWEEP_INTERVAL_MS = 12_345;

/** A second sentinel, distinct from the sweep's, so the two intervals cannot be crossed. */
export const CONFIGURED_DISPATCH_INTERVAL_MS = 23_456;

/** The tenant transaction the render handler is invoked with; opaque, compared by identity. */
export const TX_SENTINEL = { tx: "tx-sentinel" } as unknown as BmsTx;

/** What the fake `ReportDispatchService.tick` resolves; the host interpolates all four into its log line. */
export const DISPATCH_SUMMARY: ReportDispatchSummary = {
  due: 3,
  enqueued: 2,
  skippedInvalid: 1,
  durationMs: 456,
};

/** What the fake `ReportRenderService.render` resolves — one object, so `finish` can be checked by identity. */
export const RENDER_OUTCOME: RenderOutcome = { kind: "skipped", reason: "absent" };

/** The render payload the handler is invoked with; the fake ignores its fields. */
const RENDER_PAYLOAD = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  scheduleId: "44444444-4444-4444-8444-444444444444",
  periodStart: "2026-09-20",
  periodEnd: "2026-09-20",
};

const PREFIX = "bms";

/** What the wrapper's mocked `runProcessor` recorded: its positional arguments, one entry per call. */
export type RecordedRunProcessorCall = readonly unknown[];

/** What the wrapper's mocked `upsertSchedule` recorded: `(decl.name, schedule)`, one entry per call. */
export type RecordedUpsertScheduleCall = readonly [
  name: string,
  schedule: { schedulerId: string; everyMs: number },
];

/** What the constructed service's collaborators observed. */
export type WorkerHostProbe = {
  /** Every `db` handed to the fake `RuleSweepService.run`. */
  readonly sweepRuns: readonly BmsDb[];
  /** Every `(key, value)` the fake `rules-sweep` handle's `redis.set` received. */
  readonly keyWrites: readonly (readonly [key: string, value: string])[];
  /** Every handle handed to the fake `ReportDispatchService.tick`. */
  readonly dispatchTicks: readonly unknown[];
  /** Every `tx` handed to the fake `ReportRenderService.render`. */
  readonly renderTxs: readonly unknown[];
  /** Every outcome handed to the fake `ReportRenderService.finish`. */
  readonly finishedOutcomes: readonly unknown[];
};

/** A `QueueHandle` whose `client` resolves to a Redis fake that records `set`. */
function recordingHandle(keyWrites: (readonly [string, string])[]): QueueHandle {
  const redis = {
    set: async (key: string, value: string) => {
      keyWrites.push([key, value]);
      return "OK";
    },
  };
  return { client: Promise.resolve(redis) } as unknown as QueueHandle;
}

/** Constructs the service in its declared slot order and runs `onModuleInit` once. */
export async function initWorkerHost(): Promise<WorkerHostProbe> {
  const sweepRuns: BmsDb[] = [];
  const keyWrites: (readonly [string, string])[] = [];
  const dispatchTicks: unknown[] = [];
  const renderTxs: unknown[] = [];
  const finishedOutcomes: unknown[] = [];
  const client: QueueClient = {
    kind: "configured",
    prefix: PREFIX,
    connection: { host: "cache", port: 6380 },
    queues: new Map([[rulesSweepQueue.name, recordingHandle(keyWrites)]]),
    close: async () => undefined,
  };
  const ruleSweep = {
    run: async (db: BmsDb) => {
      sweepRuns.push(db);
      return SUMMARY;
    },
  } as unknown as RuleSweepService;
  const metrics = { observeRuleSweep: () => undefined } as unknown as MetricsService;
  const reportDispatch = {
    tick: async (db: unknown) => {
      dispatchTicks.push(db);
      return DISPATCH_SUMMARY;
    },
  } as unknown as ReportDispatchService;
  const reportRender = {
    render: async (_payload: unknown, tx: unknown) => {
      renderTxs.push(tx);
      return RENDER_OUTCOME;
    },
    finish: async (outcome: unknown) => {
      finishedOutcomes.push(outcome);
    },
  } as unknown as ReportRenderService;
  const service = new WorkerHostService(
    client,
    TENANT_SENTINEL,
    FLEET_SENTINEL,
    metrics,
    ruleSweep,
    {
      redis: { host: "cache", port: 6380 },
      port: 4100,
      ruleSweepIntervalMs: CONFIGURED_SWEEP_INTERVAL_MS,
      reportDispatchIntervalMs: CONFIGURED_DISPATCH_INTERVAL_MS,
    },
    reportDispatch,
    reportRender,
  );
  await service.onModuleInit();
  return { sweepRuns, keyWrites, dispatchTicks, renderTxs, finishedOutcomes };
}

function declNameOf(call: RecordedRunProcessorCall): string {
  return (call[0] as { name: string }).name;
}

function registrationOf(
  calls: readonly RecordedRunProcessorCall[],
  name: string,
): RecordedRunProcessorCall {
  const found = calls.filter((call) => declNameOf(call) === name);
  assert(
    found.length === 1,
    `expected runProcessor called exactly once for queue "${name}" from onModuleInit, got ${found.length} (all: ${calls.map(declNameOf).join(", ")})`,
  );
  return found[0] as RecordedRunProcessorCall;
}

function dbsOf(calls: readonly RecordedRunProcessorCall[], name: string): ProcessorDbs {
  return registrationOf(calls, name)[1] as ProcessorDbs;
}

export function assertHeartbeatRegistrationReceivedTheTenantSentinelAsTenantDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls, "heartbeat").tenantDb === TENANT_SENTINEL,
    "expected the heartbeat registration's dbs.tenantDb to be the TENANT_DRIZZLE slot's pool — the mapping literal is swapped, so every tenant job would run on the BYPASSRLS pool",
  );
}

export function assertHeartbeatRegistrationReceivedTheFleetSentinelAsFleetDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls, "heartbeat").fleetDb === FLEET_SENTINEL,
    "expected the heartbeat registration's dbs.fleetDb to be the FLEET_DRIZZLE slot's pool — the mapping literal is swapped, so fleet sweeps would run on the policied pool with no GUC",
  );
}

export function assertSweepRegistrationReceivedTheTenantSentinelAsTenantDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls, rulesSweepQueue.name).tenantDb === TENANT_SENTINEL,
    "expected the rules-sweep registration's dbs.tenantDb to be the TENANT_DRIZZLE slot's pool — the sweep got a different pool pair from the heartbeat",
  );
}

export function assertSweepRegistrationReceivedTheFleetSentinelAsFleetDb(
  calls: readonly RecordedRunProcessorCall[],
): void {
  assert(
    dbsOf(calls, rulesSweepQueue.name).fleetDb === FLEET_SENTINEL,
    "expected the rules-sweep registration's dbs.fleetDb to be the FLEET_DRIZZLE slot's pool — the cross-organization read would run on the policied pool with no GUC and see nothing",
  );
}

/** What the wrapper's mocked `startQueueWorkers` recorded: the `decl.name` of every registration in the array it was handed. */
export type RecordedStartedQueueNames = readonly string[];

/** ADR 0063 decision 12: every declared queue has a consumer, and every consumer a declaration. */
export function assertStartedQueueNamesEqualAllQueues(
  started: RecordedStartedQueueNames,
): void {
  const registered = new Set(started);
  const declared = new Set<string>(ALL_QUEUES.map((q) => q.name));
  const sameSet =
    registered.size === declared.size && [...declared].every((name) => registered.has(name));
  assert(
    sameSet,
    `expected the set of queue names handed to startQueueWorkers to equal the set of ALL_QUEUES names — a declared queue with no consumer grows silently (decision 12), a consumer with no declaration has no handle; started={${[...registered].sort().join(", ")}} declared={${[...declared].sort().join(", ")}}`,
  );
}

/** The other half of "exactly one": no queue gets two workers on the same connection. */
export function assertNoQueueIsStartedTwice(started: RecordedStartedQueueNames): void {
  assert(
    started.length === new Set(started).size,
    `expected each queue handed to startQueueWorkers once, got: ${started.join(", ")}`,
  );
}

/** ADR 0064 decision 6: the scheduler runs at the configured interval, under the declared id. */
export function assertSweepScheduleUpsertedAtTheConfiguredInterval(
  upserts: readonly RecordedUpsertScheduleCall[],
): void {
  const found = upserts.filter(([name]) => name === rulesSweepQueue.name);
  const expected = JSON.stringify({
    schedulerId: "rules-sweep",
    everyMs: CONFIGURED_SWEEP_INTERVAL_MS,
  });
  const actual = found.map(([, schedule]) =>
    JSON.stringify({ schedulerId: schedule.schedulerId, everyMs: schedule.everyMs }),
  );
  assert(
    actual.length === 1 && actual[0] === expected,
    `expected upsertSchedule("rules-sweep", ${expected}) exactly once — the interval is hard-coded or the scheduler id drifted; got [${actual.join(", ")}] (all upserts: ${upserts.map(([name]) => name).join(", ")})`,
  );
}

/** Runs the recorded `rules-sweep` handler the way `runProcessor` would for a `fleet` queue. */
export async function invokeSweepHandler(
  calls: readonly RecordedRunProcessorCall[],
): Promise<void> {
  const handler = registrationOf(calls, rulesSweepQueue.name)[2] as ProcessorHandler<
    typeof rulesSweepQueue
  >;
  await handler({}, { db: FLEET_SENTINEL });
}

export function assertSweepHandlerRanTheSweepOnTheHandleItWasGiven(
  probe: WorkerHostProbe,
): void {
  assert(
    probe.sweepRuns[0] === FLEET_SENTINEL,
    `expected RuleSweepService.run to receive ctx.db (the FLEET_SENTINEL) — the handler reads a different pool, or never ran the sweep; runs=${probe.sweepRuns.length}`,
  );
}

export function assertSweepHandlerWroteTheSummaryUnderTheSweepKey(
  probe: WorkerHostProbe,
): void {
  const key = ruleSweepKey(PREFIX);
  const value = JSON.stringify(SUMMARY);
  assert(
    probe.keyWrites.some(([k, v]) => k === key && v === value),
    `expected a write of JSON.stringify(summary) under "${key}" — the key write was dropped or landed elsewhere; writes=${JSON.stringify(probe.keyWrites)}`,
  );
}

/** ADR 0071 decision 8: the dispatch scheduler runs at the configured interval, under the declared id. */
export function assertDispatchScheduleUpsertedAtTheConfiguredInterval(
  upserts: readonly RecordedUpsertScheduleCall[],
): void {
  const found = upserts.filter(([name]) => name === reportsDispatchQueue.name);
  const expected = JSON.stringify({
    schedulerId: "reports-dispatch",
    everyMs: CONFIGURED_DISPATCH_INTERVAL_MS,
  });
  const actual = found.map(([, schedule]) =>
    JSON.stringify({ schedulerId: schedule.schedulerId, everyMs: schedule.everyMs }),
  );
  assert(
    actual.length === 1 && actual[0] === expected,
    `expected upsertSchedule("reports-dispatch", ${expected}) exactly once — the interval is hard-coded, crossed with the sweep's, or the scheduler id drifted; got [${actual.join(", ")}] (all upserts: ${upserts.map(([name]) => name).join(", ")})`,
  );
}

/** Runs the recorded `reports-dispatch` handler the way `runProcessor` would for a `fleet` queue. */
export async function invokeDispatchHandler(
  calls: readonly RecordedRunProcessorCall[],
): Promise<void> {
  const handler = registrationOf(calls, reportsDispatchQueue.name)[2] as ProcessorHandler<
    typeof reportsDispatchQueue
  >;
  await handler({}, { db: FLEET_SENTINEL });
}

export function assertDispatchHandlerRanTheTickOnTheHandleItWasGiven(
  probe: WorkerHostProbe,
): void {
  assert(
    probe.dispatchTicks.length === 1 && probe.dispatchTicks[0] === FLEET_SENTINEL,
    `expected ReportDispatchService.tick to receive ctx.db (the FLEET_SENTINEL) exactly once — the handler reads a different pool, never ran the tick, or is the render body registered against the wrong queue; ticks=${probe.dispatchTicks.length}`,
  );
}

/** Runs the recorded `reports-render` handler the way `runProcessor` would for a `tenant` queue and returns what it resolved. */
export async function invokeRenderHandler(
  calls: readonly RecordedRunProcessorCall[],
): Promise<void | ProcessorContinuation> {
  const handler = registrationOf(calls, reportsRenderQueue.name)[2] as ProcessorHandler<
    typeof reportsRenderQueue
  >;
  return handler(RENDER_PAYLOAD, { tx: TX_SENTINEL });
}

export function assertRenderHandlerRenderedOnTheTransactionItWasGiven(probe: WorkerHostProbe): void {
  assert(
    probe.renderTxs.length === 1 && probe.renderTxs[0] === TX_SENTINEL,
    `expected ReportRenderService.render to receive ctx.tx (the TX_SENTINEL) exactly once — the handler hands a different handle, never rendered, or is the tick registered against the wrong queue; renders=${probe.renderTxs.length}`,
  );
}

export async function assertRenderHandlerReturnsAContinuationThatFinishesTheOutcome(
  probe: WorkerHostProbe,
  resolved: void | ProcessorContinuation,
): Promise<void> {
  assert(
    typeof resolved === "object" && resolved !== null && typeof resolved.afterCommit === "function",
    `expected the render handler to resolve a ProcessorContinuation ({ afterCommit }) — phase B/C must follow the commit (R-5); got ${String(resolved)}`,
  );
  // Step-5 finding: before the continuation runs, finish must not have run —
  // a handler that awaits `finish` inline and also returns a continuation
  // would pass the count-after check alone.
  assert(
    probe.finishedOutcomes.length === 0,
    `expected finish not to have run before afterCommit() — phase B/C must follow the commit, not the handler (R-5); finished=${probe.finishedOutcomes.length}`,
  );
  await (resolved as ProcessorContinuation).afterCommit();
  assert(
    probe.finishedOutcomes.length === 1 && probe.finishedOutcomes[0] === RENDER_OUTCOME,
    `expected afterCommit() to hand ReportRenderService.finish the very outcome render returned, once; finished=${probe.finishedOutcomes.length}, identical=${probe.finishedOutcomes[0] === RENDER_OUTCOME}`,
  );
}
