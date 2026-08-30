import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";

import { AssetHealthController } from "./asset-health.controller";
import { AssetHealthService } from "./asset-health.service";
import { HealthRollupService } from "./health-rollup.service";

/**
 * `E1.3` — the asset health score (ADR 0050 + Amendment 1).
 *
 * **Two halves with different containment, deliberately in one module.**
 * `AssetHealthService` answers requests and is contained by the controller's
 * `AccessControlService` guard, because `telemetry.*` carries no Row Level
 * Security. `HealthRollupService` has no request to authorize, so it is
 * contained by `withTenant` on the tenant role (ADR 0050 decision 8). They sit
 * together because they are one feature and a reader comparing the two
 * mechanisms should not have to find them in different directories.
 *
 * **`asset-health`, not `health`.** `HealthModule` already exists and is the
 * liveness endpoint. The names stay one word apart on purpose rather than one
 * of them being renamed: `/health` is what a load balancer is pointed at.
 *
 * `HealthRollupService` starts with the API process via its own
 * `onModuleInit`, the same way `CalcSchedulerService` does. It is the second
 * scheduled host in `apps/api` (ADR 0037 decision 7 built the first); a third
 * would be the point at which extracting the loop shape stops being premature.
 *
 * `DatabaseModule`'s tokens are `@Global()`, so only `AuthModule` is imported —
 * for `AccessControlService`. Nothing is exported: no other module consumes a
 * health service yet, and the roll-up is not something another module should
 * be able to trigger.
 */
@Module({
  imports: [AuthModule],
  controllers: [AssetHealthController],
  providers: [AssetHealthService, HealthRollupService],
})
export class AssetHealthModule {}
