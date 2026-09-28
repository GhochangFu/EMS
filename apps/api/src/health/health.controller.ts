import type { LivenessResponse, ReadinessResponse } from "@bms/shared";
import { Controller, Get, HttpStatus, Optional, Res } from "@nestjs/common";
import type { Response } from "express";

import { QueueHealthService } from "../queue/queue-health.service";
import { withStorageVerdict } from "../storage/storage-health";
import { StorageHealthService } from "../storage/storage-health.service";
import { readinessFrom, withDatabaseVerdict } from "./database-health";
import { DatabaseHealthService } from "./database-health.service";

@Controller("health")
export class HealthController {
  constructor(
    private readonly queueHealth: QueueHealthService,
    private readonly databaseHealth: DatabaseHealthService,
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
   *
   * **`database` since `F4.175`** (ADR 0063 Amendment 3): an unreachable
   * database reads `degraded` here and still answers 200. The route takes no
   * `Response`, so it cannot set another status — `getReady` is where a
   * database outage becomes a non-200. The queue and database reads run in
   * parallel; the storage read follows the `!this.storageHealth` guard, which
   * `tests/f3.3-object-storage-invariants.test.ts` pins by index order.
   */
  @Get()
  async getHealth(): Promise<LivenessResponse> {
    const [base, database] = await Promise.all([
      this.queueHealth.read(),
      this.databaseHealth.read(),
    ]);
    const withDatabase = withDatabaseVerdict(base, database);
    if (!this.storageHealth) {
      return withDatabase;
    }
    return withStorageVerdict(withDatabase, await this.storageHealth.read());
  }

  /**
   * `F4.175` (ADR 0063 Amendment 3) — the **readiness** probe on both
   * processes: 200 `ready` while a bounded `select 1` on the fleet pool
   * answers, 503 `not_ready` while it does not. Only the database decides
   * it; the body carries `{ reachable }` and no connection detail.
   *
   * `passthrough: true`: Nest still serialises the body; the route touches
   * `res` only to set the status. An `HttpException` would route the body
   * through the exception filters and replace it with an error envelope.
   */
  @Get("ready")
  async getReady(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const body = readinessFrom(await this.databaseHealth.read());
    res.status(body.status === "ready" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
