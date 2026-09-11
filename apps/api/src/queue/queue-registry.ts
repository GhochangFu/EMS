import type { Logger } from "@nestjs/common";
import type { JobsOptions, Queue } from "bullmq";

import {
  QUEUE_KEY_PREFIX,
  type QueueConfig,
  type RedisConnectionOptions,
} from "./queue-config";

/**
 * The typed queue registry (ADR 0063 decisions 4, 5, 6, 7, 9).
 *
 * A queue is declared **once** with `defineQueue` — its name, its payload
 * type, its tenancy and its retry policy — and both halves of the pipeline
 * are built against that one declaration: producers call `enqueue(client,
 * decl, payload, { jobId })`, processors are registered with
 * `runProcessor(decl, …)` (`queue-processor.ts`). The plain `bullmq`
 * package, without `@nestjs/bullmq` (decision 4).
 *
 * What the registry refuses, and where:
 *
 * - **No `jobId`** (decision 5) — every job id is deterministic and supplied
 *   by the caller; BullMQ de-duplicates on it while the earlier job is
 *   retained. A queue that cannot name its job has not finished designing it.
 * - **A `tenant` payload without `organizationId`** (decision 6) — refused at
 *   `enqueue` here and re-checked at the processor, because a job can be
 *   added by a producer that is not this registry.
 * - **An unconfigured client** (decision 9) — `REDIS_URL` absent means the
 *   API boots with no queue and `enqueue` rejects with a named error; no
 *   in-memory stand-in is ever built.
 *
 * The two payload guards run **before** the availability check, so a
 * programming error is refused identically whether or not Redis exists.
 *
 * Every BullMQ `Queue` emits `error` from its connection, and Node throws on
 * an unhandled `error` event. `createQueueClient` attaches a `warn` listener
 * to each handle so a Redis restart does not take the API down — the
 * `pg.Client` failure AGENTS.md §4 *Realtime* records from before `F4.34`.
 */

export type QueueTenancy = "tenant" | "fleet";

export type TenantPayload = { readonly organizationId: string };

export type RetryPolicy = {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly removeOnComplete: number;
  readonly removeOnFail: number;
};

/**
 * Decision 7's chosen starting points — `3 / exponential 1 s / 1000 / 5000`.
 * Not measurements; a later row moves them with a number.
 */
export const RETRY_DEFAULTS: RetryPolicy = {
  attempts: 3,
  backoffMs: 1_000,
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export type QueueDeclaration<
  Name extends string = string,
  Payload extends object = object,
  Tenancy extends QueueTenancy = QueueTenancy,
> = {
  readonly name: Name;
  readonly tenancy: Tenancy;
  readonly retry: RetryPolicy;
  /** Phantom — never assigned; it carries `Payload` for `PayloadOf` to infer. */
  readonly _payload?: Payload;
};

/**
 * Declares a queue. Two overloads, so the tenancy and the payload type are
 * bound together at the declaration: a `tenant` queue's payload must extend
 * `TenantPayload`, a `fleet` queue's may be any object.
 *
 * **Type-level guard, checked 2026-09-11 (Unit 2):** a deliberate
 * `defineQueue<"t", { x: number }>({ name: "t", tenancy: "tenant" })` line
 * was added to `queue-registry.spec.ts`; the api leg of `pnpm
 * typecheck:tests` refused it with `TS2322: Type '"tenant"' is not
 * assignable to type '"fleet"'` — the `tenant` overload drops out because
 * `{ x: number }` fails `extends TenantPayload`, and the `fleet` overload is
 * the only candidate left. The line was then deleted. The overloads are the
 * gate; there is no runtime check that a `tenant` declaration's payload
 * *type* carries the field — `enqueue` checks the *value*.
 *
 * `retry` is merged over `RETRY_DEFAULTS` field by field, so a declaration
 * always carries a fully resolved policy and an explicit `undefined` cannot
 * punch a hole in it.
 */
export function defineQueue<Name extends string, Payload extends TenantPayload>(d: {
  name: Name;
  tenancy: "tenant";
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration<Name, Payload, "tenant">;
export function defineQueue<Name extends string, Payload extends object>(d: {
  name: Name;
  tenancy: "fleet";
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration<Name, Payload, "fleet">;
export function defineQueue(d: {
  name: string;
  tenancy: QueueTenancy;
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration {
  return {
    name: d.name,
    tenancy: d.tenancy,
    retry: {
      attempts: d.retry?.attempts ?? RETRY_DEFAULTS.attempts,
      backoffMs: d.retry?.backoffMs ?? RETRY_DEFAULTS.backoffMs,
      removeOnComplete: d.retry?.removeOnComplete ?? RETRY_DEFAULTS.removeOnComplete,
      removeOnFail: d.retry?.removeOnFail ?? RETRY_DEFAULTS.removeOnFail,
    },
  };
}

export type PayloadOf<D> =
  D extends QueueDeclaration<string, infer P, QueueTenancy> ? P : never;

export class QueueUnavailableError extends Error {
  override readonly name = "QueueUnavailableError";
}

/**
 * A refusal on the enqueue or processor path. `reason` is the machine-
 * readable half — specs match on it, never on the message. The message
 * names the queue and the reason only; a payload never appears in it.
 */
export class QueuePayloadError extends Error {
  override readonly name = "QueuePayloadError";

  constructor(
    readonly reason: "missing_job_id" | "missing_organization_id" | "unknown_queue",
    queueName: string,
  ) {
    super(describePayloadRefusal(reason, queueName));
  }
}

function describePayloadRefusal(
  reason: QueuePayloadError["reason"],
  queueName: string,
): string {
  switch (reason) {
    case "missing_job_id":
      return `queue "${queueName}": enqueue requires a non-empty jobId (ADR 0063 decision 5)`;
    case "missing_organization_id":
      return `queue "${queueName}": a tenant queue's payload must carry organizationId (ADR 0063 decision 6)`;
    case "unknown_queue":
      return `queue "${queueName}": not declared in this QueueClient's registry`;
  }
}

/** The subset of a BullMQ `Queue` the registry uses — small on purpose, so a fake is five lines. */
export type QueueHandle = Pick<
  Queue,
  "add" | "upsertJobScheduler" | "getJobCounts" | "client" | "close" | "on"
>;

/**
 * `connection` is carried on the configured variant so Unit 4's worker host
 * can build its `Worker`s from the same resolved options rather than
 * re-reading `process.env` (plan §8).
 */
export type QueueClient =
  | { readonly kind: "unconfigured" }
  | {
      readonly kind: "configured";
      readonly prefix: string;
      readonly connection: RedisConnectionOptions;
      readonly queues: ReadonlyMap<string, QueueHandle>;
      close(): Promise<void>;
    };

export function createQueueClient(
  config: QueueConfig,
  declarations: readonly QueueDeclaration[],
  deps: {
    createQueue: (
      name: string,
      opts: { connection: RedisConnectionOptions; prefix: string },
    ) => QueueHandle;
    logger: Pick<Logger, "warn">;
    /** Defaults to `QUEUE_KEY_PREFIX`; the integration spec isolates its keys with it. */
    prefix?: string;
  },
): QueueClient {
  if (config.redis === null) {
    deps.logger.warn(
      "REDIS_URL missing; job queue unconfigured — enqueue will reject (ADR 0063 decision 9)",
    );
    return { kind: "unconfigured" };
  }

  const prefix = deps.prefix ?? QUEUE_KEY_PREFIX;
  const connection = config.redis;
  const queues = new Map<string, QueueHandle>();

  for (const decl of declarations) {
    const handle = deps.createQueue(decl.name, { connection, prefix });
    // Mandatory: without a listener the first connection error is an
    // unhandled `error` event and the process dies. `err.name` and
    // `err.message` both — a connection error's message is the actionable
    // part (`ECONNREFUSED`, `ETIMEDOUT`) and neither ioredis nor Redis puts a
    // credential in one; a job's error is a different class and Unit 4's
    // `failed` listener logs `err.name` only.
    handle.on("error", (err) => {
      deps.logger.warn(`queue "${decl.name}" connection error: ${err.name}: ${err.message}`);
    });
    queues.set(decl.name, handle);
  }

  return {
    kind: "configured",
    prefix,
    connection,
    queues,
    close: async () => {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
    },
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Decision 6 at the producer: a `tenant` declaration's payload must name its organization. */
function assertTenancy(decl: QueueDeclaration, payload: unknown): void {
  if (decl.tenancy !== "tenant") {
    return;
  }
  const organizationId =
    typeof payload === "object" && payload !== null
      ? (payload as { organizationId?: unknown }).organizationId
      : undefined;
  if (!isNonEmptyString(organizationId)) {
    throw new QueuePayloadError("missing_organization_id", decl.name);
  }
}

/** Decision 9, then the registry check — after the payload guards, never before. */
function requireQueue(client: QueueClient, decl: QueueDeclaration): QueueHandle {
  if (client.kind === "unconfigured") {
    throw new QueueUnavailableError(
      `queue "${decl.name}": REDIS_URL is not configured, so the job queue is unavailable (ADR 0063 decision 9)`,
    );
  }
  const queue = client.queues.get(decl.name);
  if (queue === undefined) {
    throw new QueuePayloadError("unknown_queue", decl.name);
  }
  return queue;
}

/** Decision 7's policy in BullMQ's shape. Shared by `enqueue` and the scheduler template. */
function retryJobOptions(retry: RetryPolicy): JobsOptions {
  return {
    attempts: retry.attempts,
    backoff: { type: "exponential", delay: retry.backoffMs },
    removeOnComplete: { count: retry.removeOnComplete },
    removeOnFail: { count: retry.removeOnFail },
  };
}

/**
 * Adds one job. Guards in this order, each throwing before any Redis call:
 * `missing_job_id` → `missing_organization_id` (tenant queues) →
 * `QueueUnavailableError` → `unknown_queue`.
 */
export async function enqueue<D extends QueueDeclaration>(
  client: QueueClient,
  decl: D,
  payload: PayloadOf<D>,
  opts: { jobId: string },
): Promise<void> {
  if (!isNonEmptyString(opts?.jobId)) {
    throw new QueuePayloadError("missing_job_id", decl.name);
  }
  assertTenancy(decl, payload);
  const queue = requireQueue(client, decl);
  await queue.add(decl.name, payload, { jobId: opts.jobId, ...retryJobOptions(decl.retry) });
}

/**
 * Upserts a repeatable job (BullMQ's job scheduler). The same tenancy and
 * availability guards as `enqueue`; there is no `jobId` — the scheduler id
 * is the identity, and BullMQ forbids `jobId` in a scheduler template.
 */
export async function upsertSchedule<D extends QueueDeclaration>(
  client: QueueClient,
  decl: D,
  schedule: { schedulerId: string; everyMs: number },
  payload: PayloadOf<D>,
): Promise<void> {
  assertTenancy(decl, payload);
  const queue = requireQueue(client, decl);
  await queue.upsertJobScheduler(
    schedule.schedulerId,
    { every: schedule.everyMs },
    { name: decl.name, data: payload, opts: retryJobOptions(decl.retry) },
  );
}
