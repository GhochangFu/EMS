import { Module } from "@nestjs/common";

import { CalcDefinitionsService } from "../calc/calc-definitions.service";
import { CalcParametersService } from "../calc/calc-parameters.service";
import { CalcScopeService } from "../calc/calc-scope.service";
import { CalcWindowsService } from "../calc/calc-windows.service";
import { CalcWriteService } from "../calc/calc-write.service";
import { DatabaseModule } from "../database/database.module";
import { ObservabilityModule } from "../observability/observability.module";
import { CalcBackfillReads } from "./calc-backfill-reads";
import { CalcBackfillRunStore } from "./calc-backfill-run-store";
import { CalcBackfillService } from "./calc-backfill.service";

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill's leaf module for the
 * worker. It imports `DatabaseModule` and `ObservabilityModule` only, and
 * provides the five calc services the walk needs **as providers** — the
 * `ReportsCoreModule` precedent for `CalcParametersService`. **Never
 * `CalcModule`**: it imports `TelemetryModule` and hosts the scheduler and the
 * streaming host, so importing it here would start the API's loops on the
 * worker (`tests/f4.24` rule 2). None of the five is a loop host; each needs
 * only the pools and `MetricsService`.
 *
 * Nest wiring, uncovered like `main.ts`.
 */
@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [
    CalcDefinitionsService,
    CalcScopeService,
    CalcParametersService,
    CalcWindowsService,
    CalcWriteService,
    CalcBackfillReads,
    CalcBackfillRunStore,
    CalcBackfillService,
  ],
  exports: [CalcBackfillService],
})
export class CalcBackfillModule {}
