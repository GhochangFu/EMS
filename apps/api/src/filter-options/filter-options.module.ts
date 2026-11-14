import { Module } from "@nestjs/common";

import { AssetFilterScopeService } from "./asset-filter-scope.service";

/**
 * `F4.361` (ADR 0132, plan D1) — the filter options read and the narrowing
 * rule live together, so the pickers list exactly what the lists accept.
 * `AssetFilterScopeService` is exported for `AlarmsModule` and `RulesModule`.
 * Its two dependencies — `FLEET_DRIZZLE` and `AccessControlService` — resolve
 * through the `@Global()` `DatabaseModule` and `AccessControlModule`, so this
 * module imports nothing and no edge here can form a cycle.
 */
@Module({
  providers: [AssetFilterScopeService],
  exports: [AssetFilterScopeService],
})
export class FilterOptionsModule {}
