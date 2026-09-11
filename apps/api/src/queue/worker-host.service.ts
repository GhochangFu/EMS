import type { BmsDb } from "@bms/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Worker } from "bullmq";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { MetricsService } from "../observability/metrics.service";
import {
  HEARTBEAT_EVERY_MS,
  HEARTBEAT_SCHEDULER_ID,
  heartbeatKey,
  heartbeatProcessor,
  heartbeatQueue,
} from "./heartbeat";
import { runProcessor } from "./queue-processor";
import {
  QueuePayloadError,
  QueueUnavailableError,
  upsertSchedule,
  type QueueClient,
  type QueueHandle,
} from "./queue-registry";
import { startQueueWorkers, type WorkerHost } from "./worker-host";
import { QUEUE_CLIENT } from "./queue.tokens";

/**
 * The worker process's one provider (ADR 0063 decisions 3, 6, 10): on
 * `onModuleInit` it upserts the heartbeat's repeatable job and starts one
 * `Worker` per registered processor; on `onModuleDestroy` it closes them
 * (`worker.ts` enables shutdown hooks for exactly this).
 *
 * **Constructor order is a contract**: `(client, tenantDb, fleetDb,
 * metrics)`. `runProcessor` receives `{ tenantDb, fleetDb }` and a `tenant`
 * queue's handler runs inside `withTenant(tenantDb, …)` — swap the two pools
 * and every tenant job runs on the BYPASSRLS pool with a GUC nobody reads.
 * No test boots `WorkerModule` (Amendment 1), so
 * `database/fleet-read-wiring.spec.ts` pins slots 1 and 2 by token.
 *
 * **The heartbeat processor never touches Postgres.** `pg.Pool` connects
 * lazily and the handler ignores `ctx.db`, which is what makes Amendment 1's
 * stack measurement hold: a worker running only the heartbeat opens zero
 * backends. The tick lands in Redis through the heartbeat queue's own
 * connection, under `heartbeatKey(prefix)`, where `QueueHealthService` on
 * both processes reads it back.
 *
 * Nest wiring, uncovered like `main.ts`; `worker-host.spec.ts`,
 * `heartbeat.spec.ts` and `queue-registry.spec.ts` gate what it composes.
 */
@Injectable()
export class WorkerHostService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHostService.name);
  private host: WorkerHost | undefined;

  constructor(
    @Inject(QUEUE_CLIENT) private readonly client: QueueClient,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await upsertSchedule(
      this.client,
      heartbeatQueue,
      { schedulerId: HEARTBEAT_SCHEDULER_ID, everyMs: HEARTBEAT_EVERY_MS },
      {},
    );
    const heartbeat = runProcessor(
      heartbeatQueue,
      { tenantDb: this.tenantDb, fleetDb: this.fleetDb },
      heartbeatProcessor({ writeTick: (iso) => this.writeTick(iso), now: Date.now }),
    );
    this.host = startQueueWorkers(this.client, [heartbeat], {
      createWorker: (name, process, opts) => new Worker(name, process, opts),
      metrics: this.metrics,
      logger: this.logger,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.host?.close();
  }

  private async writeTick(iso: string): Promise<void> {
    const { key, handle } = heartbeatStore(this.client);
    const redis = await handle.client;
    await redis.set(key, iso);
  }
}

/**
 * Where the tick lands: the heartbeat queue's handle and its key. Both
 * refusals are unreachable once `onModuleInit`'s `upsertSchedule` has
 * passed — they exist so a tick written through a mis-built client fails
 * with a name rather than a `TypeError` on `undefined`.
 */
function heartbeatStore(client: QueueClient): { key: string; handle: QueueHandle } {
  if (client.kind === "unconfigured") {
    throw new QueueUnavailableError(
      `queue "${heartbeatQueue.name}": REDIS_URL is not configured, so the heartbeat tick has nowhere to land (ADR 0063 decision 9)`,
    );
  }
  const handle = client.queues.get(heartbeatQueue.name);
  if (handle === undefined) {
    throw new QueuePayloadError("unknown_queue", heartbeatQueue.name);
  }
  return { key: heartbeatKey(client.prefix), handle };
}
