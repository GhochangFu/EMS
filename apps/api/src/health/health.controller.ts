import type { LivenessResponse } from "@bms/shared";
import { Controller, Get, Optional } from "@nestjs/common";

import { QueueHealthService } from "../queue/queue-health.service";
import { withStorageVerdict } from "../storage/storage-health";
import { StorageHealthService } from "../storage/storage-health.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly queueHealth: QueueHealthService,
    @Optional() private readonly storageHealth?: StorageHealthService,
  ) {}

  /**
   * Liveness probe for local dev and orchestration, served by both processes
   * — the API on `PORT` and the worker on `WORKER_PORT` — with the queue
   * section ADR 0063 decision 10 adds (`configured`, `connected`, per-queue
   * depths, `lastHeartbeatAt`, `heartbeatStale`) and, since `F3.11`, ADR 0064
   * decision 8's `lastRuleSweep` — outside the verdict.
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
   *
   * **`storage` is present on the API and absent on the worker** (`F3.3`,
   * ADR 0066 decision 9, plan Q-A). Only `AppModule` imports
   * `StorageModule`, so only the API process can resolve
   * `StorageHealthService`; the worker resolves `undefined` for the
   * `@Optional()` parameter and its body carries no `storage` key at all —
   * never `{ configured: false, … }`, which would claim a state the worker
   * never reads. `withStorageVerdict` then applies the same 200-with-a-body
   * rule to the store: a configured but unreachable bucket reads
   * `degraded` (Q-B), an unconfigured one leaves the verdict alone.
   */
  @Get()
  async getHealth(): Promise<LivenessResponse> {
    const base = await this.queueHealth.read();
    if (!this.storageHealth) {
      return base;
    }
    return withStorageVerdict(base, await this.storageHealth.read());
  }
}
