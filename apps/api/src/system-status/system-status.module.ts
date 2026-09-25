import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusService } from "./system-status.service";

/**
 * `F3.30` (ADR 0075 decision 4) — the authenticated system status read.
 *
 * `AccessControlService`, the pool tokens, `QueueHealthService` and
 * `StorageHealthService` resolve through the `@Global()` `AccessControlModule`,
 * `DatabaseModule`, `QueueModule` and `StorageModule`; `AuthModule` is
 * imported for `JwtAuthGuard`, as `AssetHealthModule` does. Nothing is
 * exported. The module is API-only: `AppModule` imports it and the worker's
 * graph must not reach it (`tests/f4.24-worker-imports-no-api-loop.test.ts`),
 * which is why `StorageHealthService` is injected required here while
 * `HealthController` takes it `@Optional()`.
 * `system-status-module-wiring.spec.ts` holds the wiring.
 */
@Module({
  imports: [AuthModule],
  controllers: [SystemStatusController],
  providers: [SystemStatusService],
})
export class SystemStatusModule {}
