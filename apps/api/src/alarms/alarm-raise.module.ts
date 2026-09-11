import { Module } from "@nestjs/common";

import { AlarmRaiser } from "./alarm-raise.service";

/**
 * `F3.11` / ADR 0064 decisions 3–4 — `AlarmRaiser` on its own, so the worker
 * can raise without `AlarmsModule`.
 *
 * Loop-free by construction: it imports nothing, and `AlarmRaiser`'s one
 * dependency is `TENANT_DRIZZLE` from the `@Global()` `DatabaseModule`. That
 * holds only because decision 4 took `AlarmsGateway` out of the raiser — with
 * the gateway, this module would have needed the JWT guard, the access-control
 * service and the metrics service, and the worker's fence would have reddened
 * on `alarms.gateway.ts`. The raise announces itself with `NOTIFY bms_alarms`
 * instead, and `AlarmsModule`'s listener does the socket broadcast.
 *
 * Imported by `AlarmsModule` (which re-exports it so `RulesModule` keeps
 * resolving `AlarmRaiser` unchanged) and, from Unit 6, by `RuleSweepModule`
 * on the worker. The fence's `WORKER_LEAVES`
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts`) names this file as a
 * leaf the worker may reach.
 */
@Module({
  providers: [AlarmRaiser],
  exports: [AlarmRaiser],
})
export class AlarmRaiseModule {}
