import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AlarmKbController } from "./alarm-kb.controller";
import { AlarmKbService } from "./alarm-kb.service";

/**
 * `E2.2` PR 2 (ADR 0059 decision 4) — the browsable alarm philosophy KB.
 *
 * Declares no `imports`: `AccessControlService` and `JwtAuthGuard` come from
 * the `@Global()` `AuthModule`, and `FLEET_DRIZZLE` from the global database
 * module. Nothing here depends on `AlarmsModule` or on the admin template
 * module, which is the point — a cycle-free read over template content, owned
 * by neither.
 */
@Module({
  controllers: [AlarmKbController],
  providers: [AlarmKbService, JwtAuthGuard],
})
export class AlarmKbModule {}
