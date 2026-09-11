import type { LivenessResponse } from "@bms/shared";
import { Controller, Get } from "@nestjs/common";

import { QueueHealthService } from "../queue/queue-health.service";

@Controller("health")
export class HealthController {
  constructor(private readonly queueHealth: QueueHealthService) {}

  /**
   * Liveness probe for local dev and orchestration, served by both processes
   * — the API on `PORT` and the worker on `WORKER_PORT` — with the queue
   * section ADR 0063 decision 10 adds (`configured`, `connected`, per-queue
   * depths, `lastHeartbeatAt`, `heartbeatStale`).
   *
   * **Always HTTP 200, and `status: "degraded"` is in the body** (plan §15
   * ruling 1, ADR 0063 Amendment 1). This route is a *liveness* probe: an
   * orchestrator or load balancer that reads a non-2xx here restarts or
   * ejects the process. A stale heartbeat means the *worker* is dead, and a
   * dead worker must not make a load balancer eject an API that is serving
   * traffic — the same reasoning `metrics.service.ts` gives for refusing to
   * let a dead listener fail the probe. The reader who wants the verdict
   * reads `status`; the reader who wants the reason reads `queue`.
   *
   * An unconfigured queue (no `REDIS_URL`, ADR 0002's native-dev path) reads
   * `ok` — a chosen state, not a degradation.
   */
  @Get()
  getHealth(): Promise<LivenessResponse> {
    return this.queueHealth.read();
  }
}
