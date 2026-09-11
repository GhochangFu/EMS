import type { LivenessResponse, QueueDepth, QueueHealth } from "@bms/shared";

import type { MetricsService } from "../observability/metrics.service";
import { heartbeatIsStale } from "./heartbeat";
import type { QueueClient, QueueHandle } from "./queue-registry";

/**
 * The queue section of `GET /health`, and the verdict drawn from it (ADR
 * 0063 decisions 10, 11).
 *
 * `readQueueHealth` is pure over its `deps`: the clock, the tick reader and
 * the metrics sink are injected, so the spec runs it against two fake
 * handles and a recording gauge, and Unit 4's `QueueHealthService` hands it
 * `Date.now`, a Redis `GET` of `heartbeatKey(prefix)` and the real
 * `MetricsService`. It never touches `handle.client` itself.
 *
 * **The timeout is mandatory, not defensive.** BullMQ's `queue.client`
 * awaits a connection, and `getJobCounts` awaits `client` — so with Redis
 * down the read would hang, and a liveness probe that hangs is worse than
 * one that answers `degraded`. Every read races `Promise.all` of the per-
 * queue counts and the tick against `timeoutMs` (1.5 s by default, under any
 * sane probe interval), and a loss on either side — a rejection or the
 * timer — collapses to one `connected: false` shape with the gauges
 * untouched: a partial read must not publish half a picture.
 *
 * `livenessFrom` is the one place the verdict is decided. An unconfigured
 * queue is `ok` — a chosen state (ADR 0002's native-dev path), not a
 * degradation — and a configured one degrades when it cannot be read or when
 * the heartbeat is stale (which includes the never-ticked null, plan §15
 * ruling 5). `degraded` still answers HTTP 200 (ruling 1); the controller's
 * docblock says why.
 */

export const QUEUE_HEALTH_TIMEOUT_MS: number = 1_500;

const COUNTED_STATES = ["waiting", "active", "failed"] as const;

export type QueueHealthDeps = {
  now(): number;
  /** The last heartbeat tick as stored, or `null` when the key is absent. */
  readTick(): Promise<string | null>;
  metrics: Pick<MetricsService, "setQueueDepth">;
  /** Defaults to `QUEUE_HEALTH_TIMEOUT_MS`. */
  timeoutMs?: number;
};

/** The one failure shape: configured, but nothing could be read in time. */
function disconnected(): QueueHealth {
  return {
    configured: true,
    connected: false,
    queues: [],
    lastHeartbeatAt: null,
    heartbeatStale: true,
  };
}

async function readDepth(name: string, handle: QueueHandle): Promise<QueueDepth> {
  const counts = await handle.getJobCounts(...COUNTED_STATES);
  return {
    name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    failed: counts.failed ?? 0,
  };
}

/**
 * Rejects after `ms`. The timer is cleared by the caller on the other
 * branch so a successful read leaves no pending handle behind — a spec that
 * ran a thousand reads would otherwise hold a thousand timers open.
 */
function timeoutAfter(ms: number): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`queue health read exceeded ${ms} ms`));
    }, ms);
  });
  return {
    promise,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/** Reads the queue section of `GET /health` — per-queue depths and the heartbeat tick — bounded by `timeoutMs`; gauges are published only on a complete read. */
export async function readQueueHealth(
  client: QueueClient,
  deps: QueueHealthDeps,
): Promise<QueueHealth> {
  if (client.kind === "unconfigured") {
    return {
      configured: false,
      connected: false,
      queues: [],
      lastHeartbeatAt: null,
      heartbeatStale: false,
    };
  }

  const timeout = timeoutAfter(deps.timeoutMs ?? QUEUE_HEALTH_TIMEOUT_MS);
  let queues: QueueDepth[];
  let lastHeartbeatAt: string | null;
  try {
    [queues, lastHeartbeatAt] = await Promise.race([
      Promise.all([
        Promise.all([...client.queues].map(([name, handle]) => readDepth(name, handle))),
        deps.readTick(),
      ]),
      timeout.promise,
    ]);
  } catch {
    // A rejection from any handle, from the tick read, or from the timer:
    // one shape, gauges untouched. The cause is not surfaced here — the
    // handle's own `error` listener already logged a connection failure,
    // and a probe body is not a place for an error message.
    return disconnected();
  } finally {
    timeout.clear();
  }

  for (const depth of queues) {
    for (const state of COUNTED_STATES) {
      deps.metrics.setQueueDepth(depth.name, state, depth[state]);
    }
  }

  return {
    configured: true,
    connected: true,
    queues,
    lastHeartbeatAt,
    heartbeatStale: heartbeatIsStale(lastHeartbeatAt, deps.now()),
  };
}

/** The one place the verdict is decided: `degraded` when a configured queue is unreadable or its heartbeat is stale, `ok` otherwise. */
export function livenessFrom(queue: QueueHealth): LivenessResponse {
  const degraded = queue.configured && (!queue.connected || queue.heartbeatStale);
  return { status: degraded ? "degraded" : "ok", queue };
}
