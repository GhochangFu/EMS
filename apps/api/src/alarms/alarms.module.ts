import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";

import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEngineService } from "./alarm-engine.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmLifecycleService } from "./alarm-lifecycle.service";
import { AlarmNotifyService } from "./alarm-notify.service";
import { AlarmRaiseModule } from "./alarm-raise.module";
import { AlarmsController } from "./alarms.controller";
import { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

@Module({
  // `F3.7`: `NotificationsModule` imports nothing from alarms or rules and
  // declares no `imports` at all, so this edge is acyclic — checked before
  // adding it, not assumed, the same way `rules.module.ts` checked its own.
  //
  // `F3.11` (ADR 0064 decision 3): `AlarmRaiser` moved out to the loop-free
  // `AlarmRaiseModule` so the worker can import it without this module —
  // and with it the controller, the gateway and the JWT guard.
  imports: [TelemetryModule, VocabulariesModule, NotificationsModule, AlarmRaiseModule],
  controllers: [AlarmsController],
  providers: [
    AlarmsService,
    AlarmsGateway,
    AlarmEngineService,
    AlarmDetailsService,
    AlarmEnrichmentService,
    // `F3.10` (ADR 0057 decision 4): the 30 s lifecycle sweep — the one
    // writer of `cleared_at` / `normal_since`. Needs both pools, the two
    // notification services this module already imports, and the gateway
    // for the `cleared` broadcast; all resolvable here today.
    AlarmLifecycleService,
    // `F3.11` (ADR 0064 decision 4): the `LISTEN bms_alarms` client that
    // turns a raise from any process into this process's `created`
    // broadcast. It needs the gateway, so it lives here and not in
    // `AlarmRaiseModule`; the worker never reaches this module.
    AlarmNotifyService,
    JwtAuthGuard,
  ],
  // `RulesModule` (F3.6 task 5) needs `AlarmRaiser` so the on-demand evaluator
  // raises through the same engine as the streaming path. Re-exporting the
  // module, not the provider, is how Nest hands on a provider it did not
  // declare itself.
  exports: [AlarmRaiseModule],
})
export class AlarmsModule {}
