import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { DeviceHealthController } from "./device-health.controller";
import { DeviceHealthService } from "./device-health.service";

/**
 * `F3.16` (ADR 0127) — the admin device-health reads. `AccessControlService`
 * and the pool tokens resolve through the `@Global()` `AccessControlModule` and
 * `DatabaseModule`; `AuthModule` is imported for `JwtAuthGuard`, as
 * `SystemStatusModule` does. API-only: `AppModule` imports it, the worker does not.
 */
@Module({
  imports: [AuthModule],
  controllers: [DeviceHealthController],
  providers: [DeviceHealthService],
})
export class DeviceHealthModule {}
