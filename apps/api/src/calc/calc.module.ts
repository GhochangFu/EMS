import { Module } from "@nestjs/common";

import { TelemetryModule } from "../telemetry/telemetry.module";
import { CalcDefinitionsService } from "./calc-definitions.service";
import { CalcInputsService } from "./calc-inputs.service";
import { CalcSchedulerService } from "./calc-scheduler.service";
import { CalcStreamingService } from "./calc-streaming.service";
import { CalcWriteService } from "./calc-write.service";

/**
 * The `F2.4` calc execution engine (ADR 0037). `DRIZZLE`/`POOL_TOKEN`
 * (`DatabaseModule`) and `MetricsService` (`ObservabilityModule`) are both
 * `@Global()`, so only `TelemetryModule` needs importing here, for
 * `TelemetryBroadcastHub`.
 *
 * No controller — this module exposes no HTTP route; both hosts start with
 * the API process via their own `onModuleInit`. Nothing outside this module
 * consumes a calc service yet, so nothing is exported.
 */
@Module({
  imports: [TelemetryModule],
  providers: [
    CalcDefinitionsService,
    CalcInputsService,
    CalcWriteService,
    CalcStreamingService,
    CalcSchedulerService,
  ],
})
export class CalcModule {}
