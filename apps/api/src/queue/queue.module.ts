import { Global, Logger, Module } from "@nestjs/common";
import { Queue } from "bullmq";

import { readQueueConfig } from "./queue-config";
import { QueueHealthService } from "./queue-health.service";
import { createQueueClient, type QueueClient } from "./queue-registry";
import { ALL_QUEUES } from "./queues";
import { QUEUE_CLIENT } from "./queue.tokens";

/**
 * The one `QueueModule` (ADR 0063 decision 4), imported by both roots —
 * `AppModule` and `WorkerModule`.
 *
 * `@Global()` like `DatabaseModule` and `ObservabilityModule`, so
 * `HealthModule` (which declares no `imports`) can inject
 * `QueueHealthService`, and `F3.11` can inject `QUEUE_CLIENT` from
 * `RulesModule` the same way. The client is built once from `REDIS_URL` and
 * `ALL_QUEUES`: every declared queue gets a BullMQ `Queue` under the `bms`
 * prefix, each with the mandatory `error` listener `createQueueClient`
 * attaches. Without `REDIS_URL` the factory returns the `unconfigured`
 * variant after one warn (decision 9) — the API still boots, `enqueue`
 * rejects, `GET /health` reports `configured: false`.
 *
 * A malformed `REDIS_URL` throws `QueueConfigError` here and the process
 * refuses to boot: a set URL is a claim that Redis exists, the same rule the
 * database URLs follow. The value never appears in the message.
 *
 * Nest wiring, uncovered like `main.ts`; the registry and the health reader
 * behind it are specced in `queue-registry.spec.ts` and
 * `queue-health.spec.ts`.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CLIENT,
      useFactory: (): QueueClient =>
        createQueueClient(readQueueConfig(process.env), ALL_QUEUES, {
          createQueue: (name, opts) => new Queue(name, opts),
          logger: new Logger("QueueModule"),
        }),
    },
    QueueHealthService,
  ],
  exports: [QUEUE_CLIENT, QueueHealthService],
})
export class QueueModule {}
