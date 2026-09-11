import type { Logger } from "@nestjs/common";
import { EventEmitter } from "node:events";
import { z } from "zod";

import { heartbeatQueue } from "./heartbeat";
import type { ProcessorRegistration } from "./queue-processor";
import { defineQueue, type QueueClient } from "./queue-registry";
import { startQueueWorkers, type WorkerHandle, type WorkerHostDeps } from "./worker-host";

/**
 * F4.24 (ADR 0063 decisions 3, 9, 11) — the worker host.
 *
 * Assertions live here; `worker-host.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). One exported function per claim of plan §8's
 * `worker-host.spec.ts` paragraph, split where a claim bundles two
 * mechanisms — `failed` both counts AND warns, and the warn line's content
 * is two claims of its own (it names `err.name`; it does NOT carry
 * `err.message`), because a single assertion over the line would let the
 * negative hide behind the positive.
 *
 * `createWorker` is a fake returning an `EventEmitter`-backed handle, so the
 * spec emits `completed` / `failed` / `error` itself and reads what the
 * host's listeners did. Errors are matched on `err.name`, never
 * `instanceof` (F4.108).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function errorName(err: unknown): string | undefined {
  return typeof err === "object" && err !== null
    ? (err as { name?: unknown }).name?.toString()
    : undefined;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const otherQueue = defineQueue({
  name: "other",
  tenancy: "fleet",
  payload: z.object({ x: z.number() }),
});

const CONNECTION = { host: "cache", port: 6380 } as const;

const UNCONFIGURED: QueueClient = { kind: "unconfigured" };

function configuredClient(): QueueClient {
  return {
    kind: "configured",
    prefix: "bms",
    connection: { ...CONNECTION },
    queues: new Map(),
    close: async () => {},
  };
}

function registration(decl: ProcessorRegistration["decl"]): ProcessorRegistration {
  return { decl, process: async () => {} };
}

class FakeWorker extends EventEmitter {
  closed = false;

  async close(): Promise<void> {
    this.closed = true;
  }
}

type RecordedCreate = {
  name: string;
  process: (job: { data: unknown }) => Promise<void>;
  opts: unknown;
  worker: FakeWorker;
};

type RecordedCount = { queue: string; outcome: string };

type Harness = {
  deps: WorkerHostDeps;
  creates: RecordedCreate[];
  counts: RecordedCount[];
  warns: string[];
  logs: string[];
  workerFor(name: string): FakeWorker;
};

function harness(): Harness {
  const creates: RecordedCreate[] = [];
  const counts: RecordedCount[] = [];
  const warns: string[] = [];
  const logs: string[] = [];
  const logger: Pick<Logger, "warn" | "log"> = {
    warn: (message: unknown) => {
      warns.push(String(message));
    },
    log: (message: unknown) => {
      logs.push(String(message));
    },
  };
  return {
    creates,
    counts,
    warns,
    logs,
    deps: {
      createWorker: (name, process, opts) => {
        const worker = new FakeWorker();
        creates.push({ name, process, opts, worker });
        return worker as unknown as WorkerHandle;
      },
      metrics: {
        countQueueJob: (queue, outcome) => {
          counts.push({ queue, outcome });
        },
      },
      logger,
    },
    workerFor: (name) => {
      const found = creates.find((c) => c.name === name);
      if (found === undefined) {
        throw new Error(`no worker was created for queue "${name}"`);
      }
      return found.worker;
    },
  };
}

/**
 * A job error whose message would be recognisable if it leaked into a log
 * line: it carries the two things a payload-derived message could — an
 * organization id and a secret-looking token.
 */
class LeakyJobError extends Error {
  override readonly name = "LeakyJobError";

  constructor() {
    super("SECRET-PAYLOAD-7f3a organizationId=org-a password=hunter2");
  }
}

function startBoth(h: Harness): { close(): Promise<void> } {
  return startQueueWorkers(
    configuredClient(),
    [registration(heartbeatQueue), registration(otherQueue)],
    h.deps,
  );
}

// ---------------------------------------------------------------------------
// Unconfigured client (decision 9)
// ---------------------------------------------------------------------------

export function assertUnconfiguredClientThrowsQueueUnavailable(): void {
  const h = harness();
  let caught: unknown;
  try {
    startQueueWorkers(UNCONFIGURED, [registration(heartbeatQueue)], h.deps);
  } catch (err) {
    caught = err;
  }
  assert(
    errorName(caught) === "QueueUnavailableError",
    `expected err.name "QueueUnavailableError" on an unconfigured client, got ${String(errorName(caught))} — the host must not silently start nothing`,
  );
}

export function assertUnconfiguredClientCreatesNoWorker(): void {
  const h = harness();
  try {
    startQueueWorkers(UNCONFIGURED, [registration(heartbeatQueue)], h.deps);
  } catch {
    // the throw is the previous claim's; this one is about the side effect
  }
  assert(
    h.creates.length === 0,
    `expected no createWorker call on an unconfigured client, got ${h.creates.length}`,
  );
}

// ---------------------------------------------------------------------------
// One Worker per registration
// ---------------------------------------------------------------------------

export function assertOneWorkerPerRegistration(): void {
  const h = harness();
  startBoth(h);
  const names = JSON.stringify(h.creates.map((c) => c.name));
  assert(
    names === JSON.stringify(["heartbeat", "other"]),
    `expected one worker per registration, in order, got ${names}`,
  );
}

export function assertWorkerOptionsCarryConnectionPrefixAndConcurrencyOne(): void {
  const h = harness();
  startBoth(h);
  const expected = JSON.stringify({ connection: CONNECTION, prefix: "bms", concurrency: 1 });
  const got = JSON.stringify(h.creates[0]?.opts);
  assert(
    got === expected,
    `expected worker options exactly ${expected}, got ${got} — a dropped prefix leaks BullMQ's default "bull" namespace, and a concurrency above 1 is decision 12's question, not this row's`,
  );
}

export function assertWorkerRunsTheRegistrationsProcess(): void {
  const h = harness();
  const heartbeat = registration(heartbeatQueue);
  startQueueWorkers(configuredClient(), [heartbeat], h.deps);
  assert(
    h.creates[0]?.process === heartbeat.process,
    "expected the Worker to be handed the registration's own process function, not a wrapper or a stub",
  );
}

// ---------------------------------------------------------------------------
// completed → counter (decision 11)
// ---------------------------------------------------------------------------

export function assertCompletedIncrementsTheCompletedCounter(): void {
  const h = harness();
  startBoth(h);
  h.workerFor("heartbeat").emit("completed", { id: "j1", data: {} }, undefined, "active");
  const got = JSON.stringify(h.counts);
  assert(
    got === JSON.stringify([{ queue: "heartbeat", outcome: "completed" }]),
    `expected exactly one ("heartbeat","completed") count, got ${got}`,
  );
}

export function assertCompletedIsCountedAgainstItsOwnQueue(): void {
  const h = harness();
  startBoth(h);
  h.workerFor("other").emit("completed", { id: "j1", data: {} }, undefined, "active");
  const got = JSON.stringify(h.counts);
  assert(
    got === JSON.stringify([{ queue: "other", outcome: "completed" }]),
    `expected the count under "other", the queue whose worker completed, got ${got}`,
  );
}

// ---------------------------------------------------------------------------
// failed → counter + warn (decision 11; the warn names err.name only)
// ---------------------------------------------------------------------------

export function assertFailedIncrementsTheFailedCounter(): void {
  const h = harness();
  startBoth(h);
  h.workerFor("heartbeat").emit("failed", { id: "j1", data: {} }, new LeakyJobError(), "active");
  const got = JSON.stringify(h.counts);
  assert(
    got === JSON.stringify([{ queue: "heartbeat", outcome: "failed" }]),
    `expected exactly one ("heartbeat","failed") count, got ${got}`,
  );
}

export function assertFailedWarnsNamingTheQueueAndTheErrorName(): void {
  const h = harness();
  startBoth(h);
  h.workerFor("heartbeat").emit("failed", { id: "j1", data: {} }, new LeakyJobError(), "active");
  assert(
    h.warns.length === 1 && h.warns[0]!.includes("heartbeat") && h.warns[0]!.includes("LeakyJobError"),
    `expected one warn naming the queue and err.name, got ${JSON.stringify(h.warns)}`,
  );
}

/**
 * The negative for the claim above. A job's error message can be built from
 * its payload — an `organizationId`, a credential a future queue carries —
 * and the log pipeline retains every line (`logger.options.ts`). The host
 * logs `err.name` and nothing else of the error.
 */
export function assertFailedWarnDoesNotCarryTheErrorMessage(): void {
  const h = harness();
  startBoth(h);
  const err = new LeakyJobError();
  h.workerFor("heartbeat").emit("failed", { id: "j1", data: {} }, err, "active");
  const leaked = h.warns.filter(
    (line) =>
      line.includes(err.message) || line.includes("SECRET-PAYLOAD") || line.includes("hunter2"),
  );
  assert(
    h.warns.length === 1 && leaked.length === 0,
    `expected the warn line to omit err.message, got ${JSON.stringify(h.warns)}`,
  );
}

export function assertFailedWithoutAJobStillCountsAndWarns(): void {
  // BullMQ types `failed`'s job as `Job | undefined` — a lock lost mid-flight
  // arrives with no job. The listener must not depend on it.
  const h = harness();
  startBoth(h);
  h.workerFor("heartbeat").emit("failed", undefined, new LeakyJobError(), "active");
  assert(
    h.counts.length === 1 && h.warns.length === 1,
    `expected one count and one warn with an undefined job, got counts ${JSON.stringify(h.counts)} warns ${JSON.stringify(h.warns)}`,
  );
}

// ---------------------------------------------------------------------------
// error → warn, never a throw
// ---------------------------------------------------------------------------

export function assertErrorWarnsAndDoesNotThrow(): void {
  const h = harness();
  startBoth(h);
  let threw: unknown;
  try {
    // An `error` event with no listener makes EventEmitter throw — the
    // process-crash class. The emit returning is the claim.
    h.workerFor("heartbeat").emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
  } catch (err) {
    threw = err;
  }
  assert(
    threw === undefined && h.warns.length === 1 && h.warns[0]!.includes("heartbeat"),
    `expected the error event to warn once naming the queue and not throw, got threw=${String(errorName(threw))} warns=${JSON.stringify(h.warns)}`,
  );
}

export function assertErrorDoesNotCountAnOutcome(): void {
  const h = harness();
  startBoth(h);
  h.workerFor("heartbeat").emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
  assert(
    h.counts.length === 0,
    `expected a connection error to count no job outcome, got ${JSON.stringify(h.counts)}`,
  );
}

// ---------------------------------------------------------------------------
// close() closes every handle
// ---------------------------------------------------------------------------

export async function assertCloseClosesEveryHandle(): Promise<void> {
  const h = harness();
  const host = startBoth(h);
  await host.close();
  const open = h.creates.filter((c) => !c.worker.closed).map((c) => c.name);
  assert(
    h.creates.length === 2 && open.length === 0,
    `expected both workers closed, still open: ${JSON.stringify(open)}`,
  );
}
