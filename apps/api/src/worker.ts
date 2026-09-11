import "./load-env";
import "./observability/tracing";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type NestExpressApplication } from "@nestjs/platform-express";
import { RedisConnection } from "bullmq";
import { Logger as PinoLogger } from "nestjs-pino";

import { readWorkerConfig } from "./queue/queue-config";
import { probeRedis } from "./queue/redis-probe";
import { probeWorkerPortFree } from "./queue/worker-port-probe";
import { WorkerModule } from "./worker.module";

/**
 * `F4.24` / ADR 0063 decision 2 — the second entrypoint of `apps/api`,
 * built to `dist/worker.js`, run by `pnpm --filter api worker` and by the
 * compose `worker` service. The shape is `rotate-credentials.cli.ts`'s, with
 * one deliberate difference at the end (below).
 *
 * **Three pre-flights before any Nest context exists, then the context.**
 * Every refusal is one named stderr line and exit code 1 (decision 9, on
 * ADR 0062's boot-refusal shape; no message carries the URL, §9.6). Each
 * case below was measured on 2026-09-11 with `timeout 25 node
 * dist/worker.js` against a throwaway Redis db — exit code, seconds from
 * launch (4 s of which is loading the module graph), and whether any
 * `bms:heartbeat:*` key was written:
 *
 * 1. `readWorkerConfig` — no `REDIS_URL`: `QueueConfigError: REDIS_URL is
 *    required for the worker process` — **exit 1, 4 s, no key.** Also a
 *    malformed `REDIS_URL` or a bad `WORKER_PORT`.
 * 2. `probeWorkerPortFree` — `WORKER_PORT=6379` (bound): `QueueConfigError:
 *    WORKER_PORT 6379 cannot be bound (EADDRINUSE)` — **exit 1, 4 s, no
 *    key.** Before this pre-flight, Nest found the collision only at the
 *    end of `listen()`, *after* `onModuleInit` had upserted the scheduler:
 *    eight `bms:heartbeat:*` keys from a process that never served `/health`.
 * 3. `probeRedis` — `REDIS_URL=redis://127.0.0.1:1`: `QueueConfigError:
 *    REDIS_URL is set but Redis refused the probe: Error ECONNREFUSED` —
 *    **exit 1, 6 s, no key.** Before it, a set-but-dead Redis reached
 *    `WorkerHostService.onModuleInit`, whose `upsertSchedule` awaited an
 *    ioredis connection that retries forever: no stderr line, still
 *    running at 25 s. An unanswered `PING` is bounded at 5 s.
 * 4. `NestFactory.create` / `app.listen` — `abortOnError: false` turns
 *    Nest's default `process.abort()` (a SIGABRT with no report) into a
 *    rejection the catch names. `DATABASE_URL_FLEET` unset: `Error: F4.16:
 *    DATABASE_URL_FLEET required…` — **exit 1, 5 s, no key** (Nest's
 *    `ExceptionHandler` prints its own stack first).
 *
 * Positive control, same day: a valid environment logs `Worker listening
 * on :4199`, writes `bms:heartbeat:last` and the scheduler's keys, and
 * runs until SIGTERM.
 *
 * **The catch ends with `process.exit(1)`, not `process.exitCode = 1`.**
 * `rotate-credentials.cli.ts` sets `exitCode` and lets the loop drain,
 * which works there because its `finally` ends every pool. Here, by the
 * time case 4 rejects, `QueueModule`'s factory has built one BullMQ `Queue`
 * per declaration — each a live ioredis socket — and `onModuleInit` may
 * have started the `Worker` (Nest runs the init hooks inside `listen()`,
 * before the port is bound). Those sockets keep the event loop alive, so
 * with `exitCode` alone the "failed" worker kept running — measured with
 * `WORKER_PORT` in use and with `DATABASE_URL_FLEET` unset: stderr line
 * written, process still up at 25 s, heartbeat ticks landing. The exit is
 * explicit because nothing else ends the process. A heartbeat interrupted
 * mid-lock by that exit is retried (`attempts: 3`) and idempotent.
 *
 * `enableShutdownHooks()`, which `main.ts` does not call: it is what makes
 * `WorkerHostService.onModuleDestroy` run on SIGTERM so each `Worker`
 * closes and a job in flight is not abandoned mid-lock. Best-effort only —
 * `observability/tracing.ts` registers its own SIGTERM handler that calls
 * `process.exit(0)` after the SDK shuts down, and may win the race.
 *
 * Wiring only, uncovered like `main.ts` (§4.6); the decisions it composes
 * live in `queue-config.ts`, `redis-probe.ts`, `worker-host.ts` and
 * `heartbeat.ts`, which are specced. `process.stderr.write`, not `console.*`
 * (`scripts/checks/style-hygiene.mjs`).
 */
async function main(): Promise<void> {
  const config = readWorkerConfig(process.env);

  await probeWorkerPortFree(config.port);
  await probeRedis(config.redis, {
    // `blocking: false` keeps `maxRetriesPerRequest: 1` (BullMQ forces
    // `null` on blocking connections); `skipVersionCheck` skips a warn the
    // real queues will print anyway. Not shared — the probe owns and closes it.
    open: (options) =>
      new RedisConnection(options, { shared: false, blocking: false, skipVersionCheck: true }),
  });

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
  // Explicit, not `exitCode`: live Queue/Worker sockets would otherwise keep
  // the loop — and the "failed" worker — alive. See the docblock.
  process.exit(1);
});
