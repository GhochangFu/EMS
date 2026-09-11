import type { LivenessResponse } from "@bms/shared";
import { Inject, Injectable } from "@nestjs/common";

import { MetricsService } from "../observability/metrics.service";
import { heartbeatKey, heartbeatQueue } from "./heartbeat";
import { livenessFrom, QUEUE_HEALTH_TIMEOUT_MS, readQueueHealth } from "./queue-health";
import type { QueueClient } from "./queue-registry";
import { QUEUE_CLIENT } from "./queue.tokens";
import { ruleSweepKey, rulesSweepQueue } from "./rules-sweep";

/**
 * The injectable face of `queue-health.ts` (ADR 0063 decisions 10, 11):
 * `HealthController` calls `read()` on both processes and gets the liveness
 * body. Everything decided is in `readQueueHealth` and `livenessFrom`, which
 * are pure and specced; this class only binds the real clock, the real
 * metrics registry and two Redis `GET`s — the heartbeat key and, since
 * `F3.11` (ADR 0064 decision 8), the last-sweep key.
 *
 * Each key is read through its own queue's connection — the one BullMQ
 * already holds for that queue — so the API opens no second Redis client
 * for the probe. `handle.client` awaits the connection, which is why
 * `readQueueHealth` races the read against `QUEUE_HEALTH_TIMEOUT_MS`.
 *
 * Nest wiring, uncovered like `main.ts`; `queue-health.spec.ts` is the gate.
 */
@Injectable()
export class QueueHealthService {
  constructor(
    @Inject(QUEUE_CLIENT) private readonly client: QueueClient,
    private readonly metrics: MetricsService,
  ) {}

  async read(): Promise<LivenessResponse> {
    const queue = await readQueueHealth(this.client, {
      now: Date.now,
      readTick: () => this.readTick(),
      readSweep: () => this.readSweep(),
      metrics: this.metrics,
      timeoutMs: QUEUE_HEALTH_TIMEOUT_MS,
    });
    return livenessFrom(queue);
  }

  /**
   * `null` when unconfigured or when the heartbeat queue is not in the
   * registry — both read as "no tick", which `heartbeatIsStale` treats as
   * stale (plan §15 ruling 5): a missing consumer is never reported fresh.
   */
  private async readTick(): Promise<string | null> {
    if (this.client.kind !== "configured") {
      return null;
    }
    const handle = this.client.queues.get(heartbeatQueue.name);
    if (handle === undefined) {
      return null;
    }
    const redis = await handle.client;
    return redis.get(heartbeatKey(this.client.prefix));
  }

  /**
   * The same shape as `readTick`, on the `rules-sweep` handle: `null` when
   * unconfigured or when the queue is not in the registry, which
   * `parseRuleSweepSummary` reads as "no sweep recorded".
   */
  private async readSweep(): Promise<string | null> {
    if (this.client.kind !== "configured") {
      return null;
    }
    const handle = this.client.queues.get(rulesSweepQueue.name);
    if (handle === undefined) {
      return null;
    }
    const redis = await handle.client;
    return redis.get(ruleSweepKey(this.client.prefix));
  }
}
