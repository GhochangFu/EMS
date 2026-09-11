import type { Logger } from "@nestjs/common";
import type { JobsOptions, Queue } from "bullmq";
import { z } from "zod";

import {
  QUEUE_KEY_PREFIX,
  type QueueConfig,
  type RedisConnectionOptions,
} from "./queue-config";

/**
 * The typed queue registry (ADR 0063 decisions 4, 5, 6, 7, 9).
 *
 * A queue is declared **once** with `defineQueue` — its name, its payload
 * schema, its tenancy and its retry policy — and both halves of the pipeline
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
 * - **A structural `jobId`** — one of `RESERVED_JOB_IDS`, a character
 *   outside `JOB_ID_PATTERN`, or an all-digit id (the 2026-09-11 review,
 *   M1). BullMQ keys a job's hash at `<prefix>:<queue>:<jobId>`, the same
 *   namespace as its own bookkeeping keys, and it validates only some of the
 *   collisions itself.
 * - **A `tenant` payload without `organizationId`** (decision 6) — refused at
 *   `enqueue` here and re-checked at the processor, because a job can be
 *   added by a producer that is not this registry.
 * - **A payload that fails its schema** (the review, M2) — parsed here before
 *   any Redis call and again at the processor; a programming error is
 *   refused at the producer, with the field paths and never the values.
 * - **An unconfigured client** (decision 9) — `REDIS_URL` absent means the
 *   API boots with no queue and `enqueue` rejects with a named error; no
 *   in-memory stand-in is ever built.
 *
 * The payload guards run **before** the availability check, so a
 * programming error is refused identically whether or not Redis exists.
 *
 * Every BullMQ `Queue` emits `error` from its connection, and Node throws on
 * an unhandled `error` event. `createQueueClient` attaches a `warn` listener
 * to each handle so a Redis restart does not take the API down — the
 * `pg.Client` failure AGENTS.md §4 *Realtime* records from before `F4.34`.
 */

export type QueueTenancy = "tenant" | "fleet";

export type TenantPayload = { readonly organizationId: string };

/**
 * The schema every `tenant` queue's payload extends. `organizationId` is a
 * UUID, not any string: migration `0040_rls_on_org_bearing_tables.sql`
 * casts the `app.current_organization` GUC to `uuid` in every policy, so a
 * non-UUID would reach the processor, bind, and fail closed as a `22P02`
 * retried three times. One named refusal at `enqueue` is better than three
 * silent ones in Postgres.
 */
export const tenantPayloadSchema = z.object({ organizationId: z.string().uuid() });

export type RetryPolicy = {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly removeOnComplete: number;
  readonly removeOnFail: number;
};

/**
 * Decision 7's chosen starting points — `3 / exponential 1 s / 1000 / 5000`.
 * Not measurements; a later row moves them with a number.
 *
 * The two `removeOn*` counts also bound decision 5: a `jobId` de-duplicates
 * only while the earlier job is still retained, so once these counts have
 * evicted it the same id is accepted again — every processor must be
 * idempotent on its own row (`F3.11`'s execution row, `F3.12`'s `commands`
 * row), never on the queue.
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
  /** The payload's Zod schema; `Payload` is its output, and `PayloadOf` infers it from here. */
  readonly payload: z.ZodType<Payload, z.ZodTypeDef, unknown>;
};

/**
 * Declares a queue. Two overloads, so the tenancy and the payload schema are
 * bound together at the declaration: a `tenant` queue's schema must output a
 * `TenantPayload` (extend `tenantPayloadSchema`), a `fleet` queue's may
 * output any object. `Payload` is **inferred from the schema** — there is no
 * explicit type argument to drift from it.
 *
 * **Type-level guard, re-checked 2026-09-11 (review M2):** a deliberate
 * `defineQueue({ name: "t2", tenancy: "tenant", payload: z.object({ x:
 * z.number() }) })` line was added to `queue-registry.spec.ts`; the api leg
 * of `pnpm typecheck:tests` refused it with `TS2769: No overload matches
 * this call` — the `tenant` overload drops out because the schema's output
 * fails `extends TenantPayload`, and the `fleet` overload is the only
 * candidate left, which `tenancy: "tenant"` fails. (Unit 2's explicit-
 * generic form reported the same refusal as `TS2322` on the tenancy
 * literal; the schema form reports it at the call.) The line was then
 * deleted. The overloads are the type gate; the schema is the runtime one,
 * applied by `enqueue`, `upsertSchedule` and the processor.
 *
 * `retry` is merged over `RETRY_DEFAULTS` field by field, so a declaration
 * always carries a fully resolved policy and an explicit `undefined` cannot
 * punch a hole in it.
 */
export function defineQueue<
  Name extends string,
  Schema extends z.ZodType<TenantPayload, z.ZodTypeDef, unknown>,
>(d: {
  name: Name;
  tenancy: "tenant";
  payload: Schema;
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration<Name, z.output<Schema>, "tenant">;
export function defineQueue<
  Name extends string,
  Schema extends z.ZodType<object, z.ZodTypeDef, unknown>,
>(d: {
  name: Name;
  tenancy: "fleet";
  payload: Schema;
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration<Name, z.output<Schema>, "fleet">;
export function defineQueue(d: {
  name: string;
  tenancy: QueueTenancy;
  payload: z.ZodType<object, z.ZodTypeDef, unknown>;
  retry?: Partial<RetryPolicy>;
}): QueueDeclaration {
  return {
    name: d.name,
    tenancy: d.tenancy,
    payload: d.payload,
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
 * names the queue, the reason and, for `invalid_job_id` / `invalid_payload`,
 * the rule or the field paths; a payload value never appears in it.
 */
export class QueuePayloadError extends Error {
  override readonly name = "QueuePayloadError";

  constructor(
    readonly reason:
      | "missing_job_id"
      | "invalid_job_id"
      | "missing_organization_id"
      | "invalid_payload"
      | "unknown_queue",
    queueName: string,
    detail?: string,
  ) {
    super(describePayloadRefusal(reason, queueName, detail));
  }
}

function describePayloadRefusal(
  reason: QueuePayloadError["reason"],
  queueName: string,
  detail: string | undefined,
): string {
  switch (reason) {
    case "missing_job_id":
      return `queue "${queueName}": enqueue requires a non-empty jobId (ADR 0063 decision 5)`;
    case "invalid_job_id":
      return `queue "${queueName}": jobId ${detail ?? "is not accepted"} (it would collide with a BullMQ structural key, or BullMQ itself refuses it)`;
    case "missing_organization_id":
      return `queue "${queueName}": a tenant queue's payload must carry organizationId (ADR 0063 decision 6)`;
    case "invalid_payload":
      return `queue "${queueName}": payload failed its schema at ${detail ?? "(root)"}`;
    case "unknown_queue":
      return `queue "${queueName}": not declared in this QueueClient's registry`;
  }
}

// ---------------------------------------------------------------------------
// jobId grammar (review M1)
// ---------------------------------------------------------------------------

/**
 * The names BullMQ 5.81.5 uses for a queue's own keys under
 * `<prefix>:<queue>:` — the array `QueueKeys.getKeys` iterates
 * (`bullmq/dist/cjs/classes/queue-keys.js`) plus the literals its scripts
 * pass to `toKey` directly (`priority`, `metrics`, `logs`, `lock`). A job
 * whose id is one of these has its hash at the same key as the structure.
 *
 * Reproduced by the 2026-09-11 security review and re-measured here against
 * a real Redis: `jobId: "meta"` → `add` resolves and `getJob("meta")` returns
 * the queue's own meta hash dressed as a job; `"repeat"` → creates a HASH
 * where the scheduler needs a ZSET; `"wait"` → `WRONGTYPE`. Case-sensitive,
 * because Redis keys are. `F3.12` reads this list when it names its
 * command jobs.
 */
export const RESERVED_JOB_IDS: readonly string[] = [
  "active",
  "wait",
  "waiting-children",
  "paused",
  "id",
  "delayed",
  "prioritized",
  "stalled-check",
  "completed",
  "failed",
  "stalled",
  "repeat",
  "limiter",
  "meta",
  "events",
  "pc",
  "marker",
  "de",
  "priority",
  "metrics",
  "logs",
  "lock",
];

/**
 * One to two hundred characters of `[A-Za-z0-9_.-]`. **No colon**: BullMQ
 * 5.81.5's `Job.validateOptions` throws `Custom Id cannot contain :` unless
 * the id splits into exactly three segments (a legacy repeatable-job form) —
 * measured 2026-09-11: `"cmd-123:v2"` refused, `"a:b:c"` accepted. A grammar
 * with a hole that shape is not one to hand `F3.12`, so the colon is out.
 */
export const JOB_ID_PATTERN = /^[A-Za-z0-9_.-]{1,200}$/;

/** BullMQ also throws `Custom Id cannot be integers` (measured: `"123"`); refused here by name, before Redis. */
const ALL_DIGITS = /^\d+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Decision 5, then M1: a non-empty id that is neither structural, nor out of grammar, nor an integer. */
function assertJobId(decl: QueueDeclaration, jobId: unknown): asserts jobId is string {
  if (!isNonEmptyString(jobId)) {
    throw new QueuePayloadError("missing_job_id", decl.name);
  }
  if (RESERVED_JOB_IDS.includes(jobId)) {
    throw new QueuePayloadError("invalid_job_id", decl.name, `"${jobId}" is a BullMQ structural key name`);
  }
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new QueuePayloadError(
      "invalid_job_id",
      decl.name,
      `must be 1–200 characters of [A-Za-z0-9_.-] (got ${jobId.length} characters${jobId.includes(":") ? ", including a colon" : ""})`,
    );
  }
  if (ALL_DIGITS.test(jobId)) {
    throw new QueuePayloadError("invalid_job_id", decl.name, "must not be all digits (BullMQ reserves integer ids)");
  }
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

/**
 * Review M2: the declaration's schema, applied. Shared by `enqueue`,
 * `upsertSchedule` and `runProcessor`, so the producer and the consumer
 * refuse the same shapes with the same reason. The message carries the
 * failing field paths only — Zod's own issue messages can quote the
 * received value (`invalid_enum_value` does), so they are never forwarded.
 *
 * Runs **after** `assertTenancy` on tenant queues, which is what decides
 * which reason fires: `organizationId` absent, empty or not a string →
 * `missing_organization_id`; present, non-empty, and not a UUID → this,
 * `invalid_payload` at `organizationId`.
 */
export function parsePayload<D extends QueueDeclaration>(decl: D, payload: unknown): PayloadOf<D> {
  const result = decl.payload.safeParse(payload);
  if (!result.success) {
    const paths = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "(root)"))];
    throw new QueuePayloadError("invalid_payload", decl.name, paths.join(", "));
  }
  return result.data as PayloadOf<D>;
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

/** Builds the one `QueueClient`: one handle per declaration under `prefix`, or the unconfigured variant when `config.redis` is null. */
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
 * `missing_job_id` → `invalid_job_id` → `missing_organization_id` (tenant
 * queues) → `invalid_payload` → `QueueUnavailableError` → `unknown_queue`.
 * What reaches `add` is the schema's **output** — unknown keys stripped,
 * defaults applied — so what lands in Redis is the declared contract.
 *
 * The `jobId` de-duplicates only while the earlier job is retained
 * (`RETRY_DEFAULTS`); it is a guard on this path, not the processor's
 * idempotency, which every processor owns on its own row.
 */
export async function enqueue<D extends QueueDeclaration>(
  client: QueueClient,
  decl: D,
  payload: PayloadOf<D>,
  opts: { jobId: string },
): Promise<void> {
  assertJobId(decl, opts?.jobId);
  assertTenancy(decl, payload);
  const parsed = parsePayload(decl, payload);
  const queue = requireQueue(client, decl);
  await queue.add(decl.name, parsed, { jobId: opts.jobId, ...retryJobOptions(decl.retry) });
}

/**
 * Upserts a repeatable job (BullMQ's job scheduler). The same tenancy,
 * schema and availability guards as `enqueue`; there is no `jobId` — the
 * scheduler id is the identity, and BullMQ forbids `jobId` in a scheduler
 * template.
 */
export async function upsertSchedule<D extends QueueDeclaration>(
  client: QueueClient,
  decl: D,
  schedule: { schedulerId: string; everyMs: number },
  payload: PayloadOf<D>,
): Promise<void> {
  assertTenancy(decl, payload);
  const parsed = parsePayload(decl, payload);
  const queue = requireQueue(client, decl);
  await queue.upsertJobScheduler(
    schedule.schedulerId,
    { every: schedule.everyMs },
    { name: decl.name, data: parsed, opts: retryJobOptions(decl.retry) },
  );
}
