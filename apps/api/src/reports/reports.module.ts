import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsCoreModule } from "../notifications/notifications-core.module";
import { EnergyViewService } from "./energy-view.service";
import { ReportFilesController } from "./report-files.controller";
import { ReportFilesService } from "./report-files.service";
import { ReportProposalCheckService } from "./report-proposal-check.service";
import { ReportSchedulesController } from "./report-schedules.controller";
import { ReportSchedulesService } from "./report-schedules.service";
import { ReportScopeService } from "./report-scope";
import { ReportsController } from "./reports.controller";
import { ReportsCoreModule } from "./reports-core.module";

/**
 * `F3.5a` (ADR 0071 decision 11) — `ReportFilesController` and its service
 * join the module. `AccessControlService` resolves through the `@Global()`
 * `AccessControlModule`, the pool tokens through the global database module
 * and `STORAGE_CLIENT` through the `@Global()` `StorageModule`, so no new
 * `imports:`. `MasterDataAuditService` is provided rather than imported — the
 * `assets.module.ts` precedent: it is stateless, and `AdminModule` does not
 * export it.
 *
 * `F3.5b` (ADR 0071 decision 9) — `ReportsService` and `REPORT_FILES_CONFIG`
 * moved to the loop-free `ReportsCoreModule`, which this module imports in
 * place of providing them itself and in place of importing `CalcModule`
 * (`E4.1c`'s tariff read now resolves through the core's own
 * `CalcParametersService` provider — see the core's docblock for why). The
 * controllers stay here: the core mounts no route, so the worker that
 * imports it serves none (`tests/f4.24` rule 6).
 *
 * `F3.5b` U11 (ADR 0071 decision 11; plan R-12) — `ReportSchedulesController`
 * and its service join the module. `ReportSchedulesService` injects
 * `ChannelsService` for the `channelId` write check (Q-6), and
 * `NotificationsCoreModule` exports it without being `@Global()` — the core
 * imports that module for the render's email but does not re-export it — so
 * this module imports `NotificationsCoreModule` itself. A green build is not
 * a DI gate: the api container boot is.
 *
 * `F4.280` (ADR 0099 Amendment 8 D2, D5) — `ReportProposalCheckService` (the
 * copilot's read-only report check) joins the providers, and the module
 * exports it with `ReportSchedulesService` (the `list_report_schedules` read
 * tool) for `CopilotModule`. This module imports nothing of the copilot, so
 * the graph stays acyclic.
 *
 * `F4.290` (ADR 0099 Amendment 9 E4) — `ReportScopeService` (the site filter of
 * the energy routes and the on-demand save) is provided here, never by the
 * loop-free core: it injects `LocationAssetScopeService` from the `@Global()`
 * `AuthModule`, which `WorkerModule` does not import, and the worker renders
 * schedules with no caller to scope.
 *
 * `F4.298` (ADR 0108 decision 2) — `EnergyViewService` (the Energy page's view
 * and filter options) is provided here for the same reason: it injects
 * `ReportScopeService`, so it can never sit in the loop-free core.
 */
@Module({
  imports: [ReportsCoreModule, NotificationsCoreModule],
  controllers: [ReportsController, ReportFilesController, ReportSchedulesController],
  providers: [
    ReportFilesService,
    ReportSchedulesService,
    ReportProposalCheckService,
    ReportScopeService,
    EnergyViewService,
    MasterDataAuditService,
    JwtAuthGuard,
  ],
  exports: [ReportProposalCheckService, ReportSchedulesService],
})
export class ReportsModule {}
