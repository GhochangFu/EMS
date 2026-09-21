import { Module } from "@nestjs/common";

import { CalcParametersService } from "../calc/calc-parameters.service";
import { NotificationsCoreModule } from "../notifications/notifications-core.module";
import { ReportDispatchService } from "./report-dispatch.service";
import { ReportRenderService } from "./report-render.service";
import { readReportFilesConfig } from "./report-files-config";
import { REPORT_FILES_CONFIG } from "./report-files.tokens";
import { ReportsService } from "./reports.service";

/**
 * `F3.5b` (ADR 0071 decision 9; plan R-14) — the loop-free core of the
 * reports domain, imported by `WorkerModule` beside `RuleSweepModule` and by
 * `ReportsModule`. It holds what both processes need — the renderer
 * (`ReportsService`), the scheduled render body (`ReportRenderService`),
 * the `REPORT_FILES_CONFIG` factory (one read of the environment for both
 * processes) and the dispatcher (`ReportDispatchService`, U9) — and nothing that starts a
 * loop or mounts a route. The `RuleSweepModule` shape (ADR 0064 decision 3,
 * Amendment 1 A1): its one import is the provider-only
 * `NotificationsCoreModule`, for `EmailTransport` (the attachment forward,
 * decision 10) and `ChannelsService` (`toChannelRow`, the one place a
 * channel secret is decrypted).
 *
 * **Why `CalcParametersService` is a provider here and `CalcModule` is
 * never imported** — ADR 0071 decision 9, verbatim: "`ReportsCoreModule`
 * provides `ReportsService`, `ReportRenderService` and — **as a provider,
 * never by importing `CalcModule`** — `CalcParametersService` (one
 * `FLEET_DRIZZLE` dependency, from the `@Global()` `DatabaseModule`),
 * because `CalcModule` carries `CalcStreamingService` and
 * `CalcSchedulerService` and ADR 0063 decision 3 forbids the worker a loop
 * the API starts". Two loops, not one: the two calc hosts are the first,
 * and `CalcModule`'s own import of `TelemetryModule` (for
 * `TelemetryBroadcastHub`) reaches the telemetry `LISTEN` loop as the
 * second — both among the five loop-bearing modules ADR 0063 decision 3
 * names. The second `CalcParametersService` instance the API process now
 * carries beside `CalcModule`'s is stateless (it injects `FLEET_DRIZZLE`
 * and holds nothing — the `MasterDataAuditService` precedent in
 * `assets.module.ts`), so it answers every `resolveForAssets` call
 * identically. `tests/f4.24-worker-imports-no-api-loop.test.ts` rule 2
 * reddens on `calc/calc.module.ts` in the worker's closure — the mutation
 * the U8 commit records.
 *
 * `TENANT_DRIZZLE`, `FLEET_DRIZZLE` and `FLEET_POOL` come from the
 * `@Global()` `DatabaseModule`; `STORAGE_CLIENT` from the `@Global()`
 * `StorageModule` (which `WorkerModule` now imports too — R-3);
 * `MetricsService` from the `@Global()` `ObservabilityModule`;
 * `AccessControlService` (for `ChannelsService`) from the `@Global()`
 * `AccessControlModule`.
 *
 * Nest wiring, uncovered like `main.ts`. The compose worker boot (U10) is
 * the DI gate — `pnpm build` is not.
 */
@Module({
  imports: [NotificationsCoreModule],
  providers: [
    ReportsService,
    CalcParametersService,
    ReportRenderService,
    ReportDispatchService,
    { provide: REPORT_FILES_CONFIG, useFactory: () => readReportFilesConfig(process.env) },
  ],
  exports: [ReportsService, ReportRenderService, ReportDispatchService, REPORT_FILES_CONFIG],
})
export class ReportsCoreModule {}
