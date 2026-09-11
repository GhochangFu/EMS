import type { BmsDb } from "@bms/db";
import type { LivenessResponse, QueueHealth } from "@bms/shared";
import { Worker, type Queue } from "bullmq";
import { z } from "zod";

import type { MetricsService } from "../observability/metrics.service";
import {
  openIntegrationQueueClient,
  type IntegrationQueueClient,
} from "../testing/integration-redis-gate";
import { until } from "../testing/until";
import {
  HEARTBEAT_SCHEDULER_ID,
  heartbeatKey,
  heartbeatProcessor,
  heartbeatQueue,
} from "./heartbeat";
import { livenessFrom, QUEUE_HEALTH_TIMEOUT_MS, readQueueHealth } from "./queue-health";
import { runProcessor } from "./queue-processor";
import { defineQueue, enqueue, upsertSchedule } from "./queue-registry";
import { startQueueWorkers, type WorkerHost } from "./worker-host";

/**
 * F4.24 (ADR 0063 decisions 5, 7, 10, 13) — the queue pipeline against a
 * **real** Redis and a **real** BullMQ `Worker`: enqueue → worker → health
 * reports the completion. Every other queue spec runs against fakes; this
 * one is the proof that the registry, the processor wrapper, the worker
 * host, the heartbeat scheduler and the health reader agree with BullMQ
 * 5.81 on a live engine. Assertions live here; `queue.integration.test.ts`
 * is the Vitest wrapper (§4.6/ADR 0014), gated on `REDIS_URL` by
 * `integration-redis-gate.ts`.
 *
 * **Isolation.** Every key lives under a per-run prefix
 * (`bms-test-<pid>-<ms>`), never `bms`, so the running stack's own queue is
 * untouched. `closeQueueSuite` obliterates every queue, removes the
 * scheduler, deletes the tick key and then sweeps the prefix — the suite
 * leaves zero keys behind by construction, not by hand.
 *
 * **Shape.** One scenario runner per row of plan §9's table returns an
 * outcome; one exported assert per claim reads it. The worker and the
 * metrics fake are shared across rows, so every count is a **delta** on the
 * row's own queue name — never an aggregate — and `("heartbeat",
 * "completed")` is at-least-one, because once the scheduler runs at
 * `every: 1000` the heartbeat queue keeps completing jobs for the rest of the
 * file.
 *
 * **The timeout row does not use `timeoutMs: 1`.** Plan §9 wrote it that
 * way, but a 1 ms timer against four parallel localhost round trips is a
 * real race — on a Linux runner with a native Redis the I/O can win and the
 * row flakes. The slow leg is instead a real blocking read (`BZPOPMIN` with
 * a 1 s server-side wait, on a duplicated connection) against a 100 ms
 * budget: an order of magnitude of margin each way, and the I/O that hangs
 * is still real I/O.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ---------------------------------------------------------------------------
// Declarations and fakes
// ---------------------------------------------------------------------------

const markedSchema = z.object({ marker: z.string() });
type Marked = z.output<typeof markedSchema>;

/** `attempts: 1` so the failing row fails once, not after 1 s + 2 s of backoff. */
export const roundTripQueue = defineQueue({
  name: "q",
  tenancy: "fleet",
  payload: markedSchema,
  retry: { attempts: 1 },
});

export const failingQueue = defineQueue({
  name: "q2",
  tenancy: "fleet",
  payload: markedSchema,
  retry: { attempts: 1 },
});

/** Every declaration the suite's client carries — the two throwaways plus the real heartbeat. */
export const SUITE_QUEUES = [roundTripQueue, failingQueue, heartbeatQueue] as const;

export class RecordingMetrics implements Pick<MetricsService, "countQueueJob" | "setQueueDepth"> {
  readonly jobs: { queue: string; outcome: "completed" | "failed" }[] = [];
  readonly depths: { queue: string; state: string; n: number }[] = [];

  countQueueJob(queue: string, outcome: "completed" | "failed"): void {
    this.jobs.push({ queue, outcome });
  }

  setQueueDepth(queue: string, state: "waiting" | "active" | "failed", n: number): void {
    this.depths.push({ queue, state, n });
  }

  count(queue: string, outcome: "completed" | "failed"): number {
    return this.jobs.filter((j) => j.queue === queue && j.outcome === outcome).length;
  }
}

/**
 * Every queue here is `fleet` and no handler touches Postgres, so the
 * processor wrapper is handed a database that refuses any property access.
 * A cast alone would hide a handler that reached for `ctx.db`; this names it.
 */
const noDatabase = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`queue.integration: a fleet handler touched the database (${String(prop)})`);
    },
  },
) as unknown as BmsDb;

// ---------------------------------------------------------------------------
// Suite context
// ---------------------------------------------------------------------------

export type QueueSuite = {
  readonly prefix: string;
  readonly client: IntegrationQueueClient["client"];
  readonly queues: ReadonlyMap<string, Queue>;
  readonly metrics: RecordingMetrics;
  /** Every payload the `q` handler received, in order. */
  readonly received: Marked[];
  readonly workerWarnings: string[];
  readonly host: WorkerHost;
  readTick(): Promise<string | null>;
};

function handle(suite: Pick<QueueSuite, "client">, name: string) {
  const found = suite.client.queues.get(name);
  if (found === undefined) {
    throw new Error(`queue.integration: no handle for "${name}"`);
  }
  return found;
}

/**
 * Opens the client through the gate (a set-but-unreachable `REDIS_URL` fails
 * here, never skips) and starts one real `Worker` per declaration through
 * `startQueueWorkers` — the same call `WorkerHostService` makes, with
 * `new Worker` in place of its fake.
 */
export async function openQueueSuite(url: string, prefix: string): Promise<QueueSuite> {
  const { client, queues } = await openIntegrationQueueClient(url, "F4.24", SUITE_QUEUES, prefix);
  const metrics = new RecordingMetrics();
  const received: Marked[] = [];
  const workerWarnings: string[] = [];
  const dbs = { tenantDb: noDatabase, fleetDb: noDatabase };
  const tickKey = heartbeatKey(prefix);

  const registrations = [
    runProcessor(roundTripQueue, dbs, async (payload) => {
      received.push(payload);
    }),
    runProcessor(failingQueue, dbs, async () => {
      throw new Error("queue.integration: deliberate failure");
    }),
    runProcessor(
      heartbeatQueue,
      dbs,
      heartbeatProcessor({
        writeTick: async (iso) => {
          const redis = await handle({ client }, heartbeatQueue.name).client;
          await redis.set(tickKey, iso);
        },
        now: Date.now,
      }),
    ),
  ];

  const host = startQueueWorkers(client, registrations, {
    createWorker: (name, process, opts) => new Worker(name, process, opts),
    metrics,
    logger: {
      warn: (message: string) => {
        workerWarnings.push(message);
      },
      log: () => undefined,
    },
  });

  return {
    prefix,
    client,
    queues,
    metrics,
    received,
    workerWarnings,
    host,
    readTick: async () => {
      const redis = await handle({ client }, heartbeatQueue.name).client;
      return redis.get(tickKey);
    },
  };
}

/**
 * Workers first (so nothing is mid-job), then the scheduler, then every
 * queue's keys, then the tick, then a sweep of anything else under the
 * prefix, then the client. The sweep is what makes "zero `bms-test-*` keys"
 * a property of the code rather than of whoever last ran it.
 */
export async function closeQueueSuite(suite: QueueSuite): Promise<void> {
  await suite.host.close();
  const heartbeat = suite.queues.get(heartbeatQueue.name);
  await heartbeat?.removeJobScheduler(HEARTBEAT_SCHEDULER_ID);
  for (const queue of suite.queues.values()) {
    await queue.obliterate({ force: true });
  }
  const redis = await handle(suite, heartbeatQueue.name).client;
  await redis.del(heartbeatKey(suite.prefix));
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, { MATCH: `${suite.prefix}*`, COUNT: 100 });
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    cursor = next;
  } while (cursor !== "0");
  await suite.client.close();
}

function readHealth(suite: QueueSuite, timeoutMs = QUEUE_HEALTH_TIMEOUT_MS): Promise<QueueHealth> {
  return readQueueHealth(suite.client, {
    now: Date.now,
    readTick: () => suite.readTick(),
    metrics: suite.metrics,
    timeoutMs,
  });
}

function depthOf(health: QueueHealth, name: string) {
  return health.queues.find((q) => q.name === name);
}

// ---------------------------------------------------------------------------
// Row 1 — the round trip
// ---------------------------------------------------------------------------

export type RoundTripOutcome = {
  readonly payload: Marked;
  readonly received: Marked[];
  readonly completedDelta: number;
  readonly health: QueueHealth;
};

export async function runRoundTrip(suite: QueueSuite): Promise<RoundTripOutcome> {
  const payload: Marked = { marker: "round-trip" };
  const before = suite.metrics.count(roundTripQueue.name, "completed");
  await enqueue(suite.client, roundTripQueue, payload, { jobId: "round-trip" });
  await until(() => suite.metrics.count(roundTripQueue.name, "completed") - before >= 1, {
    timeoutMs: 10_000,
    label: "q completed once",
  });
  return {
    payload,
    received: suite.received.filter((p) => p.marker === payload.marker),
    completedDelta: suite.metrics.count(roundTripQueue.name, "completed") - before,
    health: await readHealth(suite),
  };
}

export function assertHandlerReceivedThePayload(outcome: RoundTripOutcome): void {
  assert(
    outcome.received.length === 1 && outcome.received[0].marker === outcome.payload.marker,
    `the q handler must receive the enqueued payload exactly once; got ${JSON.stringify(outcome.received)}`,
  );
}

export function assertHealthReportsTheQueueWithNoFailures(outcome: RoundTripOutcome): void {
  const depth = depthOf(outcome.health, roundTripQueue.name);
  assert(
    outcome.health.connected && depth !== undefined && depth.failed === 0,
    `health must report queue "q" connected with failed: 0; got ${JSON.stringify(outcome.health)}`,
  );
}

export function assertCompletedWasCountedOnce(outcome: RoundTripOutcome): void {
  assert(
    outcome.completedDelta === 1,
    `the metrics sink must record ("q","completed") exactly once for one job; got ${outcome.completedDelta}`,
  );
}

// ---------------------------------------------------------------------------
// Row 2 — decision 5 on real BullMQ: the same jobId twice is one job
// ---------------------------------------------------------------------------

export type DedupeOutcome = {
  readonly duplicateRuns: number;
  readonly controlRuns: number;
};

/**
 * The ADR's stated case — a double enqueue at one instant — so the second
 * `enqueue` lands before the first job is necessarily processed. The distinct
 * id is the positive control: the wait ends only when *it* has run, and with
 * one consumer in FIFO order any job the duplicate had created would have run
 * before it. So the duplicate's count is final when the control's is 1.
 */
export async function runDedupe(suite: QueueSuite): Promise<DedupeOutcome> {
  const duplicate: Marked = { marker: "dup" };
  const control: Marked = { marker: "dup-control" };
  await enqueue(suite.client, roundTripQueue, duplicate, { jobId: "dup" });
  await enqueue(suite.client, roundTripQueue, duplicate, { jobId: "dup" });
  await enqueue(suite.client, roundTripQueue, control, { jobId: "dup-control" });
  await until(() => suite.received.some((p) => p.marker === control.marker), {
    timeoutMs: 10_000,
    label: "the distinct-id control job ran",
  });
  return {
    duplicateRuns: suite.received.filter((p) => p.marker === duplicate.marker).length,
    controlRuns: suite.received.filter((p) => p.marker === control.marker).length,
  };
}

export function assertSameJobIdTwiceRunsTheHandlerOnce(outcome: DedupeOutcome): void {
  assert(
    outcome.duplicateRuns === 1,
    `enqueuing jobId "dup" twice must run the handler once (ADR 0063 decision 5); ` +
      `got ${outcome.duplicateRuns}`,
  );
}

export function assertDistinctJobIdRunsTheHandlerAgain(outcome: DedupeOutcome): void {
  assert(
    outcome.controlRuns === 1,
    `a distinct jobId must run the handler again (positive control: the wait was long enough ` +
      `for a second job to be processed); got control=${outcome.controlRuns}`,
  );
}

// ---------------------------------------------------------------------------
// Row 3 — decision 7: a failed job is counted, reported, and retained
// ---------------------------------------------------------------------------

export type FailingOutcome = {
  readonly failedDelta: number;
  readonly health: QueueHealth;
  readonly retained: { readonly found: boolean; readonly state: string | undefined };
  readonly warnings: string[];
};

export async function runFailingHandler(suite: QueueSuite): Promise<FailingOutcome> {
  const before = suite.metrics.count(failingQueue.name, "failed");
  await enqueue(suite.client, failingQueue, { marker: "boom" }, { jobId: "boom" });
  await until(() => suite.metrics.count(failingQueue.name, "failed") - before >= 1, {
    timeoutMs: 10_000,
    label: "q2 failed once",
  });
  // Decision 7's retention claim is about *later*, not the instant of failure.
  await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  const queue = suite.queues.get(failingQueue.name);
  const job = await queue?.getJob("boom");
  return {
    failedDelta: suite.metrics.count(failingQueue.name, "failed") - before,
    health: await readHealth(suite),
    retained: { found: job !== undefined, state: await job?.getState() },
    warnings: suite.workerWarnings.filter((w) => w.includes(`"${failingQueue.name}"`)),
  };
}

export function assertHealthReportsTheFailure(outcome: FailingOutcome): void {
  const depth = depthOf(outcome.health, failingQueue.name);
  assert(
    depth !== undefined && depth.failed === 1,
    `health must report queue "q2" with failed: 1; got ${JSON.stringify(outcome.health.queues)}`,
  );
}

export function assertFailedWasCountedOnce(outcome: FailingOutcome): void {
  assert(
    outcome.failedDelta === 1,
    `the metrics sink must record ("q2","failed") exactly once for attempts: 1; got ${outcome.failedDelta}`,
  );
}

export function assertTheFailedJobIsStillInRedis(outcome: FailingOutcome): void {
  assert(
    outcome.retained.found && outcome.retained.state === "failed",
    `the failed job must still be in Redis a second later, in state "failed" (decision 7); ` +
      `got ${JSON.stringify(outcome.retained)}`,
  );
}

/** The host's `failed` warn carries `err.name` and never the message (worker-host.ts). */
export function assertTheFailureWarnNamesTheClassNotTheMessage(outcome: FailingOutcome): void {
  const line = outcome.warnings.find((w) => w.includes("job failed"));
  assert(
    line !== undefined && line.includes("Error") && !line.includes("deliberate failure"),
    `the worker's failed warn must carry err.name and not err.message; got ${JSON.stringify(outcome.warnings)}`,
  );
}

// ---------------------------------------------------------------------------
// Row 4 — decision 10: the scheduler fires, the tick lands, health reads it
// ---------------------------------------------------------------------------

export type HeartbeatOutcome = {
  readonly tick: string | null;
  readonly health: QueueHealth;
  readonly liveness: LivenessResponse;
  readonly heartbeatCompleted: number;
};

/**
 * `everyMs: 1_000`, not `HEARTBEAT_EVERY_MS` — the mechanism under test is
 * the scheduler → worker → tick → health chain, and `heartbeat.spec.ts`
 * already pins the 60 s constant. Waiting a minute here would test the clock.
 *
 * Two waits, not one. The tick lands *inside* the processor, before BullMQ
 * moves the job and emits `completed`, so a read of the `completed` count
 * taken the instant the tick appears can still see zero — measured 1 red in
 * 4 by the 2026-09-11 review. The second `until` waits for the count the
 * outcome reads.
 */
export async function runHeartbeat(suite: QueueSuite): Promise<HeartbeatOutcome> {
  await upsertSchedule(
    suite.client,
    heartbeatQueue,
    { schedulerId: HEARTBEAT_SCHEDULER_ID, everyMs: 1_000 },
    {},
  );
  await until(async () => (await suite.readTick()) !== null, {
    timeoutMs: 10_000,
    label: "the heartbeat tick landed",
  });
  await until(() => suite.metrics.count(heartbeatQueue.name, "completed") >= 1, {
    timeoutMs: 10_000,
    label: "the heartbeat completion was counted",
  });
  const health = await readHealth(suite);
  return {
    tick: await suite.readTick(),
    health,
    liveness: livenessFrom(health),
    heartbeatCompleted: suite.metrics.count(heartbeatQueue.name, "completed"),
  };
}

export function assertTheTickIsAnInstant(outcome: HeartbeatOutcome): void {
  assert(
    outcome.tick !== null && !Number.isNaN(Date.parse(outcome.tick)),
    `the heartbeat processor must write an ISO-8601 instant; got ${JSON.stringify(outcome.tick)}`,
  );
}

export function assertHealthReportsTheTick(outcome: HeartbeatOutcome): void {
  assert(
    outcome.health.lastHeartbeatAt !== null,
    `health must report lastHeartbeatAt after a tick; got ${JSON.stringify(outcome.health)}`,
  );
}

export function assertAFreshTickIsNotStale(outcome: HeartbeatOutcome): void {
  assert(
    outcome.health.heartbeatStale === false,
    `a tick seconds old must not be stale; got ${JSON.stringify(outcome.health)}`,
  );
}

export function assertLivenessIsOk(outcome: HeartbeatOutcome): void {
  assert(
    outcome.liveness.status === "ok",
    `livenessFrom must answer "ok" for a connected, fresh queue; got ${outcome.liveness.status}`,
  );
}

export function assertHeartbeatCompletionWasCounted(outcome: HeartbeatOutcome): void {
  assert(
    outcome.heartbeatCompleted >= 1,
    `the metrics sink must record ("heartbeat","completed") at least once; got ${outcome.heartbeatCompleted}`,
  );
}

// ---------------------------------------------------------------------------
// Row 5 — the hang guard against real I/O
// ---------------------------------------------------------------------------

export type TimeoutOutcome = {
  readonly health: QueueHealth;
  readonly depthWrites: number;
  readonly slowReadMs: number;
};

const SLOW_READ_BUDGET_MS = 100;
const BLOCKING_READ_SECONDS = 1;

/**
 * The tick read is a real Redis read that Redis itself holds for
 * `BLOCKING_READ_SECONDS` (`BZPOPMIN` on a key nothing pushes to), on a
 * duplicated connection so the queue's own connection stays free for the
 * counts — which do resolve, and are discarded. The budget is 100 ms. The
 * blocked read is awaited to completion before the connection is quit, so
 * nothing is left pending when the runner exits.
 */
export async function runTimeoutGuard(suite: QueueSuite): Promise<TimeoutOutcome> {
  const redis = await handle(suite, heartbeatQueue.name).client;
  const slow = redis.duplicate();
  const metrics = new RecordingMetrics();
  let pending: Promise<unknown> = Promise.resolve();
  const started = Date.now();
  try {
    const health = await readQueueHealth(suite.client, {
      now: Date.now,
      readTick: async () => {
        pending = slow.bzpopmin(`${suite.prefix}:never`, BLOCKING_READ_SECONDS);
        await pending;
        return slow.get(heartbeatKey(suite.prefix));
      },
      metrics,
      timeoutMs: SLOW_READ_BUDGET_MS,
    });
    const elapsed = Date.now() - started;
    await pending;
    return { health, depthWrites: metrics.depths.length, slowReadMs: elapsed };
  } finally {
    await slow.quit().catch(() => undefined);
  }
}

export function assertASlowReadCollapsesToDisconnected(outcome: TimeoutOutcome): void {
  assert(
    outcome.health.connected === false,
    `a read slower than its budget must report connected: false; got ${JSON.stringify(outcome.health)}`,
  );
}

export function assertTheTimeoutFiredWithinItsBudget(outcome: TimeoutOutcome): void {
  assert(
    outcome.slowReadMs < BLOCKING_READ_SECONDS * 1_000,
    `the read must return on the ${SLOW_READ_BUDGET_MS} ms timer, not after the ` +
      `${BLOCKING_READ_SECONDS} s block; took ${outcome.slowReadMs} ms`,
  );
}

export function assertASlowReadLeavesTheGaugeAlone(outcome: TimeoutOutcome): void {
  assert(
    outcome.depthWrites === 0,
    `a timed-out read must publish no depth gauge; got ${outcome.depthWrites} writes`,
  );
}
