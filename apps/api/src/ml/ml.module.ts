import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { MlController } from "./ml.controller";
import { MlAnomaliesService } from "./ml-anomalies.service";
import { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` (ADR 0135 Amendment 3 R-c) — the forecast read API.
 * `AccessControlService` and the pool tokens resolve through the `@Global()`
 * `AccessControlModule` and `DatabaseModule`; `AuthModule` is imported for
 * `JwtAuthGuard`, as `DeviceHealthModule` does. API-only: `AppModule` imports
 * it, the worker does not. `E1.2b` (Amendment 5 A-e) adds the anomaly reads.
 */
@Module({
  imports: [AuthModule],
  controllers: [MlController],
  providers: [MlForecastsService, MlAnomaliesService],
})
export class MlModule {}
