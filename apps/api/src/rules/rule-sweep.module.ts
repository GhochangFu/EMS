import { Module } from "@nestjs/common";

import { AlarmRaiseModule } from "../alarms/alarm-raise.module";
import { NotificationsCoreModule } from "../notifications/notifications-core.module";
import { RuleSweepService } from "./rule-sweep.service";

/**
 * `F3.11` / ADR 0064 decision 3, Amendment 1 A1 — the sweep body's module,
 * **loop-free by construction**: it starts nothing in `onModuleInit`, and its
 * two imports are the two provider-only carves (`AlarmRaiseModule`,
 * `NotificationsCoreModule`) whose closures reach no `runSweepLoop`, no
 * listener and no controller. `TENANT_DRIZZLE` comes from the `@Global()`
 * `DatabaseModule`; `AccessControlService` (for `ChannelsService`) from the
 * `@Global()` `AccessControlModule`, which `WorkerModule` imports beside this.
 *
 * Imported by `WorkerModule` and by nothing that starts a loop
 * (`tests/f4.24-worker-imports-no-api-loop.test.ts` rule 7 names this file as
 * a consumer `main.ts`'s closure must not reach). `RulesModule` and
 * `AlarmsModule` do **not** import it: the tick lives in `WorkerHostService`
 * beside the heartbeat's, one consumer per queue (ADR 0063 decision 12), and a
 * worker whose closure reaches `RulesModule` or `AlarmsModule` is the defect
 * the fence reddens on.
 */
@Module({
  imports: [AlarmRaiseModule, NotificationsCoreModule],
  providers: [RuleSweepService],
  exports: [RuleSweepService],
})
export class RuleSweepModule {}
