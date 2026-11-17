import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { MlController } from "./ml.controller";
import { MlAnomaliesService } from "./ml-anomalies.service";
import { MlFindingsController } from "./ml-findings.controller";
import { MlFindingsService } from "./ml-findings.service";
import { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` (ADR 0135 Amendment 3 R-c) — the forecast read API.
 * `AccessControlService` and the pool tokens resolve through the `@Global()`
 * `AccessControlModule` and `DatabaseModule`; `AuthModule` is imported for
 * `JwtAuthGuard`, as `DeviceHealthModule` does. API-only: `AppModule` imports
 * it, the worker does not. `E1.2b` (Amendment 5 A-e) adds the anomaly reads.
 *
 * `E1.9a` (Amendment 8): `FilterOptionsModule` for `AssetFilterScopeService`
 * (it imports nothing, so the edge forms no cycle), the findings summary
 * controller and `MlFindingsService`, exported for the paragraph module
 * (`E1.9c`). `ml-module-wiring.spec.ts` holds the graph.
 */
@Module({
  imports: [AuthModule, FilterOptionsModule],
  controllers: [MlController, MlFindingsController],
  providers: [MlForecastsService, MlAnomaliesService, MlFindingsService],
  exports: [MlFindingsService],
})
export class MlModule {}
