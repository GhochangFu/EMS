import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportFilesController } from "./report-files.controller";
import { ReportFilesService } from "./report-files.service";
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
 */
@Module({
  imports: [ReportsCoreModule],
  controllers: [ReportsController, ReportFilesController],
  providers: [ReportFilesService, MasterDataAuditService, JwtAuthGuard],
})
export class ReportsModule {}
