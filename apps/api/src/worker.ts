import "./load-env";
import "./observability/tracing";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { Logger as PinoLogger } from "nestjs-pino";

import { readWorkerConfig } from "./queue/queue-config";
import { WorkerModule } from "./worker.module";

/**
 * `F4.24` / ADR 0063 decision 2 — the second entrypoint of `apps/api`,
 * built to `dist/worker.js`, run by `pnpm --filter api worker` and by the
 * compose `worker` service. The shape is `rotate-credentials.cli.ts`'s.
 *
 * **`readWorkerConfig` runs first.** A missing `REDIS_URL` throws
 * `QueueConfigError` before any pool or Nest context exists — decision 9's
 * refused boot, on ADR 0062's boot-refusal shape: one named stderr line and
 * exit code 1. The message never carries the URL (§9.6).
 *
 * `abortOnError: false`: Nest's default on an initialisation error is
 * `process.abort()`, a SIGABRT with no report. With it off, a throw from
 * `WorkerHostService.onModuleInit` (Redis reachable by DNS but refusing, a
 * `DatabaseModule` missing one of its three URLs) is caught below, named,
 * and the process exits 1 on its own.
 *
 * `enableShutdownHooks()`, which `main.ts` does not call: it is what makes
 * `WorkerHostService.onModuleDestroy` run on SIGTERM so each BullMQ `Worker`
 * closes and a job in flight is not abandoned mid-lock. Best-effort only —
 * `observability/tracing.ts` registers its own SIGTERM handler that calls
 * `process.exit(0)` after the SDK shuts down, and may win the race. A
 * heartbeat killed mid-flight is retried (`attempts: 3`) and idempotent.
 *
 * Wiring only, uncovered like `main.ts` (§4.6); the decisions it composes
 * live in `queue-config.ts`, `worker-host.ts` and `heartbeat.ts`, which are
 * specced. `process.stderr.write`, not `console.*`
 * (`scripts/checks/style-hygiene.mjs`).
 */
async function main(): Promise<void> {
  const config = readWorkerConfig(process.env);

  const app = await NestFactory.create<NestExpressApplication>(WorkerModule, {
    bufferLogs: true,
    abortOnError: false,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  await app.listen(config.port);
  Logger.log(`Worker listening on :${config.port}`, "Worker");
}

main().catch((err: unknown) => {
  const name = err instanceof Error ? err.name : "Error";
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`worker failed to start: ${name}: ${message}\n`);
  process.exitCode = 1;
});
