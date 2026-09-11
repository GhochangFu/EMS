import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { pinoHttpOptions } from "./logger.options";
import { ObservabilityModule } from "./observability/observability.module";
import { QueueModule } from "./queue/queue.module";
import { WorkerHostService } from "./queue/worker-host.service";

/**
 * The worker process's root (ADR 0063 decisions 2, 3) — **a second root, not
 * a subset of `AppModule`.** It composes the leaf modules the heartbeat needs
 * and nothing that starts a loop: the same logger and its redaction
 * (`logger.options.ts`), the three pools (`DatabaseModule` — `pg.Pool`
 * connects lazily, so a worker that runs only the heartbeat opens no
 * backend), the metrics registry and `GET /metrics` (`ObservabilityModule`),
 * the queue client and `GET /health` (`QueueModule`, `HealthModule`), and
 * the one provider that does the work (`WorkerHostService`).
 *
 * **This module may import a module only while
 * `tests/f4.24-worker-imports-no-api-loop.test.ts` stays green.** That test
 * is decision 3's gate as Amendment 1 re-states it: the worker's import
 * closure reaches none of the six `onModuleInit` loop sites, the sweep
 * primitive, the `LISTEN` client, the five loop-bearing modules, `AppModule`
 * or `main.ts`. `RulesModule` cannot be imported here today — it reaches
 * `AlarmsModule → TelemetryModule` and every loop behind them. The day
 * `F3.11` needs the rules service in this process, the test reddens and the
 * split is that row's work, not a flag.
 *
 * Nest wiring, uncovered like `main.ts`.
 */
@Module({
  imports: [
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions }),
    DatabaseModule,
    ObservabilityModule,
    QueueModule,
    HealthModule,
  ],
  providers: [WorkerHostService],
})
export class WorkerModule {}
