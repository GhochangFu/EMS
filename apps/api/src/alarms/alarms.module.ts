import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { TelemetryModule } from "../telemetry/telemetry.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";

import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEngineService } from "./alarm-engine.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
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
    JwtAuthGuard,
  ],
  // `RulesModule` (F3.6 task 5) needs `AlarmRaiser` so the on-demand evaluator
  // raises through the same engine as the streaming path.
  exports: [AlarmRaiser],
})
export class AlarmsModule {}
