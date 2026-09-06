import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";

import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEngineService } from "./alarm-engine.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmLifecycleService } from "./alarm-lifecycle.service";
import { AlarmRaiser } from "./alarm-raise.service";
import { AlarmsController } from "./alarms.controller";
import { AlarmsGateway } from "./alarms.gateway";
import { AlarmsService } from "./alarms.service";

@Module({
  // `F3.7`: `NotificationsModule` imports nothing from alarms or rules and
  // declares no `imports` at all, so this edge is acyclic — checked before
  // adding it, not assumed, the same way `rules.module.ts` checked its own.
  imports: [TelemetryModule, VocabulariesModule, NotificationsModule],
  controllers: [AlarmsController],
  providers: [
    AlarmsService,
    AlarmsGateway,
    AlarmEngineService,
    AlarmRaiser,
    AlarmDetailsService,
    AlarmEnrichmentService,
    // `F3.10` (ADR 0057 decision 4): the 30 s lifecycle sweep — the one
    // writer of `cleared_at` / `normal_since`. Needs both pools, the two
    // notification services this module already imports, and the gateway
    // for the `cleared` broadcast; all resolvable here today.
    AlarmLifecycleService,
    JwtAuthGuard,
  ],
  // `RulesModule` (F3.6 task 5) needs `AlarmRaiser` so the on-demand evaluator
  // raises through the same engine as the streaming path.
  exports: [AlarmRaiser],
})
export class AlarmsModule {}
