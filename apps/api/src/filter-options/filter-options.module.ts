import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetFilterScopeService } from "./asset-filter-scope.service";
import { FilterOptionsController } from "./filter-options.controller";
import { FilterOptionsService } from "./filter-options.service";

/**
 * `F4.361` (ADR 0132, plan D1) — the filter options read and the narrowing
 * rule live together, so the pickers list exactly what the lists accept.
 * `AssetFilterScopeService` is exported for `AlarmsModule` and `RulesModule`.
 * `GET /filter-options` (`FilterOptionsController`) is its one route. The
 * services' two dependencies — `FLEET_DRIZZLE` and `AccessControlService` — resolve
 * through the `@Global()` `DatabaseModule` and `AccessControlModule`, so this
 * module imports nothing and no edge here can form a cycle.
 */
@Module({
  controllers: [FilterOptionsController],
  providers: [AssetFilterScopeService, FilterOptionsService, JwtAuthGuard],
  exports: [AssetFilterScopeService],
})
export class FilterOptionsModule {}
