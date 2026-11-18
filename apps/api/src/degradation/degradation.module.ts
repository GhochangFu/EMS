import { Module } from "@nestjs/common";

import { AssetHealthModule } from "../asset-health/asset-health.module";
import { AuthModule } from "../auth/auth.module";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { DegradationController } from "./degradation.controller";
import { DegradationService } from "./degradation.service";

/**
 * `E1.5a` / ADR 0138 (plan T1.8, R-s) — degradation trends and time-to-limit
 * estimates: `GET /degradation` and `GET /assets/:assetId/degradation`,
 * computed when a page asks; no table, no cache, nothing written.
 *
 * `AuthModule` for `JwtAuthGuard`; `FilterOptionsModule` exports
 * `AssetFilterScopeService` and imports nothing; `AssetHealthModule` exports
 * `AssetHealthService` (the template health blocks and, above the cap, the
 * current score) and imports only `AuthModule`, so no edge forms a cycle.
 * `AccessControlService` and the pools resolve through the `@Global()`
 * `AccessControlModule` and `DatabaseModule`. Nothing is exported. API only:
 * `AppModule` imports it, the worker does not.
 * `degradation-module-wiring.spec.ts` holds the graph.
 */
@Module({
  imports: [AuthModule, FilterOptionsModule, AssetHealthModule],
  controllers: [DegradationController],
  providers: [DegradationService],
})
export class DegradationModule {}
