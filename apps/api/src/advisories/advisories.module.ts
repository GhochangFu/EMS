import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { MlAnomaliesService } from "../ml/ml-anomalies.service";
import { TariffRatesModule } from "../tariffs/tariff-rates.module";
import { AdvisoriesController } from "./advisories.controller";
import { AdvisoriesService } from "./advisories.service";

/**
 * `E1.6a` / ADR 0137 decision 9 (plan R-c, T1.7) — the optimisation advisories:
 * `GET /advisories` and `GET /assets/:assetId/advisories`, computed when a page
 * asks; no table, no cache, nothing written.
 *
 * `AuthModule` for `JwtAuthGuard`; `FilterOptionsModule` exports
 * `AssetFilterScopeService` and imports nothing, so the edge forms no cycle;
 * `TariffRatesModule` is provider-only and loop-free and exports
 * `EnergyRateResolver`. `MlAnomaliesService` is **provided here**, not imported
 * (R-c, the `CopilotAvailabilityService` precedent): `MlModule` does not export
 * it and is not edited, and the service needs only the two global pool tokens.
 * `AccessControlService` and the pools resolve through the `@Global()`
 * `AccessControlModule` and `DatabaseModule`. Nothing is exported. API only:
 * `AppModule` imports it, the worker does not. `advisories-module-wiring.spec.ts`
 * holds the graph.
 */
@Module({
  imports: [AuthModule, FilterOptionsModule, TariffRatesModule],
  controllers: [AdvisoriesController],
  providers: [AdvisoriesService, MlAnomaliesService],
})
export class AdvisoriesModule {}
