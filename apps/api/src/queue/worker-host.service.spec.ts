import "reflect-metadata";

import type { BmsDb } from "@bms/db";
import type { RuleSweepSummary } from "@bms/shared";

import type { MetricsService } from "../observability/metrics.service";
import type { RuleSweepService } from "../rules/rule-sweep.service";
import type { ProcessorDbs, ProcessorHandler } from "./queue-processor";
import type { QueueClient, QueueHandle } from "./queue-registry";
import { ALL_QUEUES } from "./queues";
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
  const service = new WorkerHostService(
    client,
    TENANT_SENTINEL,
    FLEET_SENTINEL,
    metrics,
    ruleSweep,
    { redis: { host: "cache", port: 6380 }, port: 4100, ruleSweepIntervalMs: CONFIGURED_SWEEP_INTERVAL_MS },
  );
  await service.onModuleInit();
  return { sweepRuns, keyWrites };
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
