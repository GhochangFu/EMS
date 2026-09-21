import { Module } from "@nestjs/common";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { CalcModule } from "../calc/calc.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportFilesController } from "./report-files.controller";
import { ReportFilesService } from "./report-files.service";
import { readReportFilesConfig } from "./report-files-config";
import { REPORT_FILES_CONFIG } from "./report-files.tokens";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * `F3.5a` (ADR 0071 decision 11) — `ReportFilesController` and its service
 * join the module. `AccessControlService` resolves through the `@Global()`
 * `AccessControlModule`, the pool tokens through the global database module
 * and `STORAGE_CLIENT` through the `@Global()` `StorageModule`, so no new
 * `imports:`. `MasterDataAuditService` is provided rather than imported — the
 * `assets.module.ts` precedent: it is stateless, and `AdminModule` does not
 * export it. `REPORT_FILES_CONFIG` is read once from the environment at
 * provider time (R-11), the `WORKER_CONFIG` shape.
 */
@Module({
  // `E4.1c` — `CalcParametersService` for the tariff read (ADR 0070 decision 7).
  imports: [CalcModule],
  controllers: [ReportsController, ReportFilesController],
  providers: [
    ReportsService,
    ReportFilesService,
    MasterDataAuditService,
    { provide: REPORT_FILES_CONFIG, useFactory: () => readReportFilesConfig(process.env) },
    JwtAuthGuard,
  ],
})
export class ReportsModule {}
