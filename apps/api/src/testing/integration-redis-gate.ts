import { Queue } from "bullmq";

import { readQueueConfig } from "../queue/queue-config";
import { createQueueClient, type QueueClient, type QueueDeclaration } from "../queue/queue-registry";

/**
 * F4.24 (ADR 0063 decision 13) — the integration-test Redis gate, the
 * `REDIS_URL` twin of `integration-db-gate.ts`.
 *
 * **The asymmetry is the whole point, and it is easy to copy wrongly.** An
 * unset `REDIS_URL` is not the same event in the two environments:
 *
 * - **Locally** it means "no Redis handy" — skip, and say why on stderr,
 *   naming the value to set and the compose command that finds a remapped
 *   port, because the coverage thresholds in `vitest.config.ts` are measured
 *   with the queue suite running.
 * - **In CI** it means the pipeline is broken — `ci.yml` declares the `redis`
 *   service and exports `REDIS_URL`, so an unset value there is a workflow
 *   edit, not an environment choice. Skipping would produce a green run that
 *   asserted nothing about the queue behaviour decision 13 made a gate. So it
 *   **throws**.
 *
 * And a *set* `REDIS_URL` is a claim that a Redis exists, so an unreachable
 * one fails in **both** environments rather than skipping — see
 * {@link openIntegrationQueueClient}.
 *
 * The verdict is a pure function of the environment, separate from the
 * effects, so `integration-redis-gate.spec.ts` enumerates all four
 * combinations directly. Asserting only that `queue.integration` still passes
 * would prove nothing — on a machine with `REDIS_URL` set it passes under
 * every mutation of the CI branch.
 */

/** What the environment says should happen. Pure; no effects, no `process` read. */
export type IntegrationRedisVerdict =
  | { readonly kind: "run"; readonly url: string }
  | { readonly kind: "skip" }
  | { readonly kind: "refuse" };

/**
 * The decision, as a total function of the two variables that matter — the
 * same predicate `integrationDbVerdict` uses, so the two gates cannot drift
 * on what counts as CI.
 */
export function integrationRedisVerdict(env: {
  REDIS_URL?: string | undefined;
  CI?: string | undefined;
}): IntegrationRedisVerdict {
  const url = env.REDIS_URL;
  // `CI` is set to the string "true" by GitHub Actions; "1" is accepted because
  // other runners use it. Anything else — including "false", "0" and "" — is not CI.
  const isCi = env.CI === "true" || env.CI === "1";
  if (url) {
    return { kind: "run", url };
  }
  return isCi ? { kind: "refuse" } : { kind: "skip" };
}

/**
 * Applies {@link integrationRedisVerdict} to the real environment at module
 * scope.
 *
 * Returns the URL, or `undefined` when the suite must skip — feed it straight
 * to `describe.skipIf(!redisUrl)`. Throws when the verdict is `refuse`, which
 * is deliberately an import-time failure: a `describe` that never registers
 * is indistinguishable from one that passed.
 *
 * @param item backlog id, e.g. `"F4.24"` — prefixes both messages
 * @param label what the suite covers, e.g. `"queue integration tests"`
 * @param because why a green run without Redis asserts nothing. Suite-specific
 *   and load-bearing: it is what tells whoever broke the pipeline which
 *   guarantee just stopped being checked. Name the behaviours, not the feature.
 */
export function requireIntegrationRedis({
  item,
  label,
  because,
}: {
  item: string;
  label: string;
  because: string;
}): string | undefined {
  const verdict = integrationRedisVerdict(process.env);

  if (verdict.kind === "refuse") {
    throw new Error(`${item} ${label} have no REDIS_URL in CI. Refusing to skip — ${because}`);
  }

  if (verdict.kind === "skip") {
    // `process.stderr.write`, not `console.warn`: Vitest intercepts `console` and
    // discards module-scope output from a skipped file, so the warning that
    // explains the coverage failure would itself be invisible.
    process.stderr.write(
      `\n[${item}] Skipping ${label}: REDIS_URL is not set.\n` +
        "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
        "        REDIS_URL=redis://localhost:6379 pnpm test:coverage\n" +
        "        (6379 is the committed compose port; docker-compose.override.yml may remap it —\n" +
        "        `docker compose port redis 6379` prints the one in use)\n\n",
    );
    return undefined;
  }

  return verdict.url;
}

/** The configured variant of {@link QueueClient}, plus the raw `Queue`s a suite's cleanup needs. */
export type IntegrationQueueClient = {
  readonly client: Extract<QueueClient, { kind: "configured" }>;
  /**
   * The same objects `client.queues` holds, typed as BullMQ `Queue` rather
   * than the registry's narrow `QueueHandle`, so `afterAll` can call
   * `obliterate`, `removeJobScheduler` and `getJob` without a cast.
   */
  readonly queues: ReadonlyMap<string, Queue>;
};

const REACHABILITY_TIMEOUT_MS = 5_000;

/**
 * Rejects after `ms`. Cleared by the caller on the other branch so a
 * successful probe leaves no pending handle behind.
 */
function timeoutAfter(ms: number): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`did not answer PING within ${ms} ms`));
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
 * Opens a real `QueueClient` (`new Queue` per declaration, under `prefix`)
 * and proves it reaches Redis before any suite depends on it.
 *
 * The other half of the asymmetry: a **set** `REDIS_URL` is a claim that a
 * Redis exists, so an unreachable one fails everywhere rather than skipping.
 * Without this, a typo in the URL degrades to a suite that skips locally and
 * — because the value is set — never trips the CI refusal either.
 *
 * **The bound wraps the `client` await, not only the `PING`.** BullMQ's
 * `queue.client` awaits `waitUntilReady`, and against a closed port ioredis
 * retries forever (`retryStrategy` never returns `false`) while the `end`
 * event `waitUntilReady` also listens for never fires — so
 * `await handle.client` alone would hang the runner. The client is closed
 * before throwing, for the same reason `openIntegrationPool` ends its pool:
 * a failed `beforeAll` must not leak a handle. `Queue.close()` on a
 * still-initialising connection disconnects rather than awaiting readiness.
 *
 * `PING` is not on BullMQ's `IRedisClient` interface; the ioredis proxy
 * forwards it at runtime. The `typeof` guard turns a future BullMQ that stops
 * forwarding into a named failure rather than a `TypeError`.
 *
 * The thrown message never carries the URL — it can hold a password
 * (AGENTS.md §9.6). ioredis's own connection errors name the host and port
 * only.
 */
export async function openIntegrationQueueClient(
  url: string,
  item: string,
  declarations: readonly QueueDeclaration[],
  prefix: string,
): Promise<IntegrationQueueClient> {
  const queues = new Map<string, Queue>();
  const client = createQueueClient(readQueueConfig({ REDIS_URL: url }), declarations, {
    createQueue: (name, opts) => {
      const queue = new Queue(name, opts);
      queues.set(name, queue);
      return queue;
    },
    logger: {
      warn: (message: string) => {
        process.stderr.write(`[${item}] ${message}\n`);
      },
    },
    prefix,
  });

  if (client.kind !== "configured") {
    throw new Error(
      `${item}: REDIS_URL is set but readQueueConfig read it as unconfigured (whitespace-only?). ` +
        "Setting REDIS_URL is a claim that a Redis exists, so this fails rather than skipping.",
    );
  }

  const first = client.queues.values().next();
  if (first.done) {
    await client.close().catch(() => undefined);
    throw new Error(`${item}: openIntegrationQueueClient needs at least one declaration to probe through`);
  }

  const timeout = timeoutAfter(REACHABILITY_TIMEOUT_MS);
  try {
    await Promise.race([
      first.value.client.then(async (redis) => {
        const pinger = redis as unknown as { ping?: unknown };
        if (typeof pinger.ping !== "function") {
          throw new Error("BullMQ's Redis client no longer forwards ping()");
        }
        const reply: unknown = await (pinger.ping as () => Promise<unknown>)();
        if (reply !== "PONG") {
          throw new Error(`PING answered ${String(reply)}, not PONG`);
        }
      }),
      timeout.promise,
    ]);
  } catch (err) {
    await client.close().catch(() => undefined);
    // `code` carries the actionable part for the common failures (ECONNREFUSED,
    // ENOTFOUND), and `err.message` alone omits it.
    const detail =
      typeof err === "object" && err !== null
        ? [(err as { message?: string }).message, (err as { code?: string }).code]
            .filter(Boolean)
            .join(" ") || String((err as { name?: string }).name)
        : String(err);
    throw new Error(
      `${item} could not reach REDIS_URL: ${detail}. Setting REDIS_URL is a claim ` +
        "that a Redis exists, so this fails rather than skipping.",
    );
  } finally {
    timeout.clear();
  }

  return { client, queues };
}
