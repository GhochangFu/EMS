import { Module } from "@nestjs/common";

import { AlarmRaiseModule } from "../alarms/alarm-raise.module";
import { DeviceHealthSweepService } from "./device-health-sweep.service";

/**
 * `F3.16` / ADR 0127 decision 12 — the device-health sweep on the worker, a
 * loop-free leaf on the `RuleSweepModule` shape: it imports `AlarmRaiseModule`
 * only (the raiser's one dependency, `TENANT_DRIZZLE`, comes from the
 * `@Global()` `DatabaseModule`), and the fleet handle arrives per job as
 * `ctx.db`. `DeviceHealthModule` (the admin routes) is never imported here;
 * `tests/f4.24-worker-imports-no-api-loop.test.ts` lists this file in
 * `WORKER_LEAVES`.
 */
@Module({
  imports: [AlarmRaiseModule],
  providers: [DeviceHealthSweepService],
  exports: [DeviceHealthSweepService],
})
export class DeviceHealthSweepModule {}
