import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

import { AccessControlModule } from "./auth/access-control.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { pinoHttpOptions } from "./logger.options";
import { ObservabilityModule } from "./observability/observability.module";
import { readWorkerConfig } from "./queue/queue-config";
import { QueueModule } from "./queue/queue.module";
import { WORKER_CONFIG } from "./queue/queue.tokens";
import { WorkerHostService } from "./queue/worker-host.service";
import { ReportsCoreModule } from "./reports/reports-core.module";
import { RuleSweepModule } from "./rules/rule-sweep.module";
import { StorageModule } from "./storage/storage.module";

/**
 * The worker process's root (ADR 0063 decisions 2, 3; ADR 0064 decision 3,
 * Amendment 1 A1) — **a second root, not a subset of `AppModule`.** It
 * composes the leaf modules the two processors need and nothing that starts
 * a loop: the same logger and its redaction (`logger.options.ts`), the three
 * pools (`DatabaseModule`), the metrics registry and `GET /metrics`
 * (`ObservabilityModule`), the queue client and `GET /health` (`QueueModule`,
 * `HealthModule`), the sweep body (`RuleSweepModule`, whose closure reaches
 * `AlarmRaiser` and `NotificationsService` through the two provider-only
 * carves and no controller), the `@Global()` `AccessControlModule` that
 * `ChannelsService` resolves `AccessControlService` from without `AuthModule`,
 * and the one provider that does the work (`WorkerHostService`).
 *
 * **`F3.5b` (ADR 0071 decisions 8–10; plan R-3) adds two imports.**
 * `ReportsCoreModule` is the loop-free carve of the reports domain — the
 * render body (`ReportRenderService`), the renderer and, from U9, the
 * dispatcher — built on the `RuleSweepModule` shape and gated by the same
 * fence. `StorageModule` is imported because the render job writes and reads
 * back report objects; `storage.module.ts` said "never `WorkerModule`" until
 * this row, and its consequences are recorded rather than hidden: the
 * worker's `GET /health` now carries the `storage` section
 * (`livenessResponseSchema.storage` stays `.optional()` — a boot with
 * storage unconfigured still answers), `StorageBootstrap.onModuleInit` runs
 * `ensureBucket` on **both** processes (the `BUCKET_RACE_NAMES` race between
 * them is already swallowed), and the worker image loads
 * `@aws-sdk/client-s3` at start. A fourth the plan did not name: the core's
 * closure reaches `reports.service.ts` and `energy-pdf.ts`, so the worker
 * process also loads `xlsx` and the `pdfmake` singleton at start.
 *
 * **`WORKER_CONFIG` is a second, deterministic read of the environment
 * `worker.ts` already validated.** `readWorkerConfig` ran before any Nest
 * context existed and refused a bad `REDIS_URL`, `WORKER_PORT` or
 * `RULE_SWEEP_INTERVAL_MS` with exit 1; by the time this factory runs the
 * same `process.env` parses to the same value, so the token carries the
 * interval into `WorkerHostService` without a `process.env` read inside the
 * service. The API process never provides this token.
 *
 * **This module may import a module only while
 * `tests/f4.24-worker-imports-no-api-loop.test.ts` stays green.** That test
 * is decision 3's gate as Amendment 1 re-states it: the worker's import
 * closure reaches none of the seven `onModuleInit` loop sites, the four loop
 * hosts, the five loop-bearing modules, `AppModule` or `main.ts`; it mounts
 * exactly two controllers (rule 6); and its `WORKER_LEAVES` list is the
 * enumeration of what this module may import. The split the `F4.24` version
 * of this docblock deferred happened under `F3.11`: `RulesModule` and
 * `AlarmsModule` still cannot be imported here — they reach `TelemetryModule`
 * and every loop behind it — so the sweep lives in the loop-free
 * `RuleSweepModule`, and a future row that needs more of the API in this
 * process carves the same way and adds its leaf to that list.
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
    AccessControlModule,
    RuleSweepModule,
    // `F3.5b` — R-3: the render job puts, gets and deletes report objects.
    StorageModule,
    ReportsCoreModule,
  ],
  providers: [
    WorkerHostService,
    { provide: WORKER_CONFIG, useFactory: () => readWorkerConfig(process.env) },
  ],
})
export class WorkerModule {}
