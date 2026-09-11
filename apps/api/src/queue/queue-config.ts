/**
 * The queue and worker configuration readers (ADR 0063 decisions 4, 9).
 *
 * `readQueueConfig` mirrors `realtime/redis-io.adapter.ts`'s rule for
 * `REDIS_URL`: unset or whitespace-only reads as **unconfigured**, not an
 * error, so a native-dev machine without Redis still boots the API with the
 * queue reporting `unconfigured` rather than refusing to start. `redis: null`
 * carries that meaning through to `createQueueClient` (Unit 2).
 *
 * `readWorkerConfig` is stricter — decision 9 requires the worker process to
 * refuse to start without Redis, because the worker has nothing else to do.
 *
 * A `redis://` URL can carry a password, so `redisOptionsFromUrl` never
 * includes the raw input in a thrown message (AGENTS.md §9.6).
 */

export const QUEUE_KEY_PREFIX = "bms";

/**
 * Annotated `: number` rather than left as a literal type — the ingest
 * host's `DEFAULT_HEALTH_PORT` lesson (`apps/ingest/src/host/config.ts`).
 * Without the annotation, TypeScript would narrow a comparison against this
 * constant to a tautology and `tsc` would refuse it with `TS2367`.
 */
export const DEFAULT_WORKER_PORT: number = 4100;

export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

export class QueueConfigError extends Error {
  override readonly name = "QueueConfigError";
}

/**
 * Parses a `redis://` or `rediss://` URL into the shape BullMQ's `Queue`
 * and `Worker` accept as `connection`. Throws `QueueConfigError` on any
 * failure — **the raw value never appears in the thrown message**, because
 * it can carry a password. Each guard has its own message (the 2026-09-11
 * review, C: all five used to say "must use the redis or rediss scheme",
 * which was false for four of them); none names the value, so the message
 * says which rule failed and the operator reads the value from their env.
 */
export function redisOptionsFromUrl(raw: string): RedisConnectionOptions {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QueueConfigError("REDIS_URL is not a valid URL");
  }

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new QueueConfigError("REDIS_URL must use the redis or rediss scheme");
  }

  if (!url.hostname) {
    throw new QueueConfigError("REDIS_URL must name a host");
  }

  const options: RedisConnectionOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
  };

  try {
    if (url.username) {
      options.username = decodeURIComponent(url.username);
    }
    if (url.password) {
      options.password = decodeURIComponent(url.password);
    }
  } catch {
    // `decodeURIComponent` throws `URIError` on a malformed percent-escape
    // (e.g. a lone `%`). The raw value is never in this message either.
    throw new QueueConfigError("REDIS_URL credentials carry a malformed percent-escape");
  }

  const dbPath = url.pathname.replace(/^\//, "");
  if (dbPath.length > 0) {
    if (!/^\d+$/.test(dbPath)) {
      throw new QueueConfigError("REDIS_URL path must be a numeric database index");
    }
    options.db = Number(dbPath);
  }

  if (url.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}

export type QueueConfig = {
  /** `null` means unconfigured — no `REDIS_URL` was set. */
  readonly redis: RedisConnectionOptions | null;
};

/** Reads `REDIS_URL` from `env`: unset or blank is unconfigured (`redis: null`); a set value must parse. */
export function readQueueConfig(
  env: Record<string, string | undefined>,
): QueueConfig {
  const raw = env.REDIS_URL?.trim();
  if (!raw) {
    return { redis: null };
  }
  return { redis: redisOptionsFromUrl(raw) };
}

export type WorkerConfig = {
  readonly redis: RedisConnectionOptions;
  readonly port: number;
};

const MAX_PORT = 65535;

function readWorkerPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_WORKER_PORT;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new QueueConfigError(
      `WORKER_PORT must be a positive integer, got "${raw}"`,
    );
  }
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0 || value > MAX_PORT) {
    throw new QueueConfigError(
      `WORKER_PORT must be a positive integer, got "${raw}"`,
    );
  }
  return value;
}

/**
 * `readQueueConfig` runs first, so a missing `REDIS_URL` is refused before
 * `WORKER_PORT` is even looked at — the plan's table rules out the port
 * guard firing first on an otherwise-unconfigured worker.
 */
export function readWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  const queueConfig = readQueueConfig(env);
  if (queueConfig.redis === null) {
    throw new QueueConfigError(
      "REDIS_URL is required for the worker process (ADR 0063 decision 9)",
    );
  }
  return {
    redis: queueConfig.redis,
    port: readWorkerPort(env.WORKER_PORT),
  };
}
