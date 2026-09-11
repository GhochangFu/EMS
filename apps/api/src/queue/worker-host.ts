import type { Logger } from "@nestjs/common";
import type { Worker } from "bullmq";

import type { MetricsService } from "../observability/metrics.service";
import type { RedisConnectionOptions } from "./queue-config";
import type { ProcessorRegistration } from "./queue-processor";
import { QueueUnavailableError, type QueueClient } from "./queue-registry";

/**
 * The worker host (ADR 0063 decisions 3, 9, 11): one BullMQ `Worker` per
 * registered processor, on the connection the `QueueClient` already
 * resolved, with the two counters and the three listeners every worker
 * needs. Pure over its `deps` — `createWorker` is injected so the spec runs
 * it against `EventEmitter`-backed fakes and `WorkerHostService` hands it
 * `new Worker(...)`.
 *
 * **An unconfigured client throws.** The worker process refused earlier
 * (`readWorkerConfig`, decision 9), so this is unreachable there; the throw
 * exists so a caller that somehow arrives here without Redis gets a named
 * refusal rather than a host that silently started nothing — decision 3's
 * "not an environment flag" applied to the host itself.
 *
 * **`concurrency: 1`.** One consumer per queue is decision 12's point; a
 * higher number is `F3.11`'s question for its own queue.
 *
 * **What the `failed` warn carries: the queue and `err.name`, nothing
 * else.** A job's error can be built from its payload — an `organizationId`,
 * a credential a future queue carries — and every log line is retained by
 * the Loki pipeline (`logger.options.ts`). `err.message` is therefore never
 * logged from a job failure. The `error` event is a different class: it
 * carries BullMQ's and ioredis's own errors (a lost lock, `ECONNREFUSED`),
 * never the processor's exception, and there the message is the actionable
 * part — so, as `createQueueClient`'s listener does, it logs both. That
 * listener is mandatory either way: Node throws on an unhandled `error`
 * event, and a Redis restart would otherwise take the worker down.
 */

export type WorkerHandle = Pick<Worker, "on" | "close">;

export type WorkerHostDeps = {
  createWorker: (
    name: string,
    process: (job: { data: unknown }) => Promise<void>,
    opts: { connection: RedisConnectionOptions; prefix: string; concurrency: number },
  ) => WorkerHandle;
  metrics: Pick<MetricsService, "countQueueJob">;
  logger: Pick<Logger, "warn" | "log">;
};

export type WorkerHost = { close(): Promise<void> };

export function startQueueWorkers(
  client: QueueClient,
  registrations: readonly ProcessorRegistration[],
  deps: WorkerHostDeps,
): WorkerHost {
  if (client.kind === "unconfigured") {
    throw new QueueUnavailableError(
      "REDIS_URL is not configured, so no queue worker can start (ADR 0063 decision 9)",
    );
  }

  const handles: WorkerHandle[] = [];
  for (const { decl, process } of registrations) {
    const name = decl.name;
    const worker = deps.createWorker(name, process, {
      connection: client.connection,
      prefix: client.prefix,
      concurrency: 1,
    });
    worker.on("completed", () => {
      deps.metrics.countQueueJob(name, "completed");
    });
    worker.on("failed", (_job, err) => {
      deps.metrics.countQueueJob(name, "failed");
      deps.logger.warn(`queue "${name}" job failed: ${err.name}`);
    });
    worker.on("error", (err) => {
      deps.logger.warn(`queue "${name}" worker error: ${err.name}: ${err.message}`);
    });
    deps.logger.log(`queue "${name}" worker started (concurrency 1, prefix "${client.prefix}")`);
    handles.push(worker);
  }

  return {
    close: async () => {
      await Promise.all(handles.map((handle) => handle.close()));
    },
  };
}
