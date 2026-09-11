import type { ProcessorHandler } from "./queue-processor";
import { defineQueue } from "./queue-registry";

/**
 * The `heartbeat` queue (ADR 0063 decision 10) — the one queue this row
 * ships, and not a placeholder.
 *
 * The worker host (Unit 4) upserts one repeatable job every
 * `HEARTBEAT_EVERY_MS` under `HEARTBEAT_SCHEDULER_ID`; the processor writes
 * the instant it ran to the Redis key `heartbeatKey(prefix)`. That exercises
 * the exact primitive `F3.11` builds on — a BullMQ job scheduler — and gives
 * both processes something true to report on `GET /health`: the API reads
 * the key back and `heartbeatIsStale` decides whether the consumer is alive.
 *
 * **Fleet, not tenant.** The heartbeat has no organization; a `tenant`
 * declaration here would make `enqueue` and the processor demand an
 * `organizationId` the job cannot carry. The payload is `Record<string,
 * never>` — an empty object, and the type refuses a field being smuggled in.
 *
 * **The processor never touches Postgres.** It receives `ctx.db` because a
 * fleet handler always does, and ignores it — that is what lets ADR 0063
 * Amendment 1's runtime measurement hold (`pg.Pool` connects lazily, so a
 * worker that runs only the heartbeat opens zero backends).
 */

/**
 * Annotated `: number` rather than left as a literal type — the ingest
 * host's `DEFAULT_HEALTH_PORT` lesson (`apps/ingest/src/host/config.ts`):
 * without the annotation, `tsc` narrows a comparison against the constant to
 * a tautology and refuses it with `TS2367`.
 */
export const HEARTBEAT_EVERY_MS: number = 60_000;

/**
 * Three ticks is decision 10's starting point, "on the same terms as
 * decision 7's counts" — a later row moves it with a number. Annotated for
 * the same reason as `HEARTBEAT_EVERY_MS`.
 */
export const HEARTBEAT_STALE_TICKS: number = 3;

/** The job scheduler id. The scheduler is the identity — there is no `jobId` on a repeatable job. */
export const HEARTBEAT_SCHEDULER_ID = "heartbeat";

export const heartbeatQueue = defineQueue<"heartbeat", Record<string, never>>({
  name: "heartbeat",
  tenancy: "fleet",
});

/**
 * The Redis key the tick lands in, under the queue prefix so it sits beside
 * BullMQ's own `bms:heartbeat:*` keys and inside the namespace the
 * integration spec isolates with its own prefix.
 */
export function heartbeatKey(prefix: string): string {
  return `${prefix}:heartbeat:last`;
}

/**
 * The processor: one write of the injected clock as an ISO-8601 instant.
 * `now` is injected rather than read from `Date.now()` so the spec can prove
 * the tick is the clock it was given — and so the worker host can hand it
 * the real one.
 */
export function heartbeatProcessor(deps: {
  writeTick(iso: string): Promise<void>;
  now(): number;
}): ProcessorHandler<typeof heartbeatQueue> {
  return async () => {
    await deps.writeTick(new Date(deps.now()).toISOString());
  };
}

/**
 * Whether the last tick is too old to trust the consumer is alive.
 *
 * Three answers, in order:
 *
 * 1. `null` → stale. A fresh Redis the worker has never ticked is a queue
 *    with no consumer, which is the condition ADR 0063 Q4 exists to make
 *    visible (plan §15 ruling 5).
 * 2. Unparseable → stale. `Date.parse` returns `NaN`, and **NaN makes every
 *    comparison false** — without this branch a corrupted key would read as
 *    fresh forever. The guard fails closed.
 * 3. Otherwise, older than `HEARTBEAT_STALE_TICKS × HEARTBEAT_EVERY_MS`
 *    (strictly greater — a tick exactly three ticks old is still fresh).
 */
export function heartbeatIsStale(lastIso: string | null, nowMs: number): boolean {
  if (lastIso === null) {
    return true;
  }
  const parsed = Date.parse(lastIso);
  if (Number.isNaN(parsed)) {
    return true;
  }
  return nowMs - parsed > HEARTBEAT_STALE_TICKS * HEARTBEAT_EVERY_MS;
}
