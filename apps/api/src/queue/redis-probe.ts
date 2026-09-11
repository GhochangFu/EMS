import { QueueConfigError, type RedisConnectionOptions } from "./queue-config";

/**
 * The worker's bounded Redis reachability probe (ADR 0063 decision 9 — the
 * worker refuses to start without a usable Redis).
 *
 * Added by the 2026-09-11 review (Blocker A). Before it, `readWorkerConfig`
 * refused only an *unset* `REDIS_URL`; a set-but-dead one
 * (`redis://127.0.0.1:1`) reached `WorkerHostService.onModuleInit`, whose
 * `upsertSchedule` awaited BullMQ's `queue.client` — and that awaits an
 * ioredis connection whose default `retryStrategy` never gives up. Measured:
 * no stderr line, still running at 25 s. The same hang would have hidden a
 * typo in the URL behind a worker that looks started.
 *
 * The shape is `integration-redis-gate.ts`'s `openIntegrationQueueClient`:
 * one connection, `client` then `PING`, raced against a bound, closed in
 * `finally`. Two differences: it opens a bare BullMQ `RedisConnection`
 * rather than a `Queue` (a `Queue` writes its `meta` hash on init, and a
 * probe must leave no key), and the three ioredis options that make one
 * attempt mean one attempt — `lazyConnect` (connect on the `client` await,
 * not in the constructor), `maxRetriesPerRequest: 1`, `enableOfflineQueue:
 * false`. `ioredis` itself is not importable from `apps/api` (it is
 * `bullmq`'s dependency, not this package's, and §9.4 gates a new one), which
 * is why the client comes through `bullmq`'s exported wrapper.
 *
 * `RedisConnection.close()` on a still-initialising connection
 * `disconnect()`s rather than awaiting readiness, so the `finally` returns
 * promptly after a timeout and the caller's `process.exit(1)` is reached.
 *
 * **What the thrown message carries: the bound, or the cause's `name` and
 * `code`.** Never the URL (AGENTS.md §9.6 — it can hold a password) and
 * never the cause's own message text, which ioredis builds from the host
 * and port. `ECONNREFUSED` / `ENOTFOUND` is the actionable part.
 */

export const REDIS_PROBE_TIMEOUT_MS: number = 5_000;

/** The parsed URL plus the three options that bound one attempt to one attempt. */
export type ProbeConnectionOptions = RedisConnectionOptions & {
  readonly lazyConnect: true;
  readonly maxRetriesPerRequest: 1;
  readonly enableOfflineQueue: false;
};

/** The slice of BullMQ's `RedisConnection` the probe uses — small so the spec's fake is five lines. */
export type ProbeConnection = {
  readonly client: Promise<unknown>;
  on(event: "error", listener: (err: Error) => void): unknown;
  close(): Promise<void>;
};

export type RedisProbeDeps = {
  open(options: ProbeConnectionOptions): ProbeConnection;
  /** Defaults to `REDIS_PROBE_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/**
 * Rejects after `ms`. Cleared by the caller on the other branch so a
 * successful probe leaves no pending handle behind.
 */
function timeoutAfter(ms: number): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ProbeFailure(`did not answer PING within ${ms} ms`));
    }, ms);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * A failure this module built itself — the timer, a missing `ping`, a
 * non-`PONG` reply. Its message is this file's own text, so it is safe to
 * forward; a foreign error's message is not (see the docblock).
 */
class ProbeFailure extends Error {
  override readonly name = "ProbeFailure";
}

function hasCode(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    ((err as { code: string }).code.length > 0)
  );
}

/** `name` and `code` of a foreign error, and nothing else. */
function nameAndCode(err: unknown): string {
  const name =
    typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  const code =
    typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  const parts = [name, code].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : "unknown error";
}

/** Resolves when Redis answers `PONG` within the bound; throws `QueueConfigError` otherwise. Always closes. */
export async function probeRedis(
  connection: RedisConnectionOptions,
  deps: RedisProbeDeps,
): Promise<void> {
  const conn = deps.open({
    ...connection,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  // Mandatory: `RedisConnection` re-emits every ioredis `error` (one per
  // refused connect), and an unhandled `error` event throws. The verdict is
  // the race's, not the event's — but only the event carries the code.
  // Traced 2026-09-11 against `redis://127.0.0.1:1` with `lazyConnect`:
  // `error` ECONNREFUSED at +11 ms, `close`, then a second `error` — the
  // code-less `Connection is closed.` BullMQ re-emits from its own
  // `initializing.catch` — and the `client` rejection with that same
  // code-less error at +14 ms. So the *last* event is not the one to keep;
  // the last *coded* one is. Without this the message read `refused the
  // probe: Error`.
  let lastCoded: unknown;
  conn.on("error", (err) => {
    if (hasCode(err)) {
      lastCoded = err;
    }
  });

  const timeout = timeoutAfter(deps.timeoutMs ?? REDIS_PROBE_TIMEOUT_MS);
  try {
    await Promise.race([
      conn.client.then(async (redis) => {
        // `PING` is not on BullMQ's `IRedisClient` interface; the ioredis
        // proxy forwards it at runtime (the integration gate's guard).
        const pinger = redis as { ping?: unknown };
        if (typeof pinger.ping !== "function") {
          throw new ProbeFailure("client no longer forwards ping() (BullMQ upgrade?)");
        }
        const reply: unknown = await (pinger.ping as () => Promise<unknown>)();
        if (reply !== "PONG") {
          throw new ProbeFailure("PING did not answer PONG");
        }
      }),
      timeout.promise,
    ]);
  } catch (err) {
    const detail =
      err instanceof ProbeFailure
        ? err.message
        : `refused the probe: ${nameAndCode(hasCode(err) ? err : (lastCoded ?? err))}`;
    throw new QueueConfigError(`REDIS_URL is set but Redis ${detail}`);
  } finally {
    timeout.clear();
    await conn.close().catch(() => undefined);
  }
}
