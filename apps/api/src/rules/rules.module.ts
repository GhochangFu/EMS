import { Module } from "@nestjs/common";

import { AlarmsModule } from "../alarms/alarms.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  // `AlarmsModule → TelemetryModule` only, so this edge is acyclic — checked
  // before adding it, not assumed (F3.6 task 5).
  // `NotificationsModule` imports nothing from rules, so this edge is acyclic —
  // checked before adding it (F3.8 U7), the same way the AlarmsModule edge was.
  imports: [VocabulariesModule, AlarmsModule, NotificationsModule],
  controllers: [RulesController],
  providers: [RulesService, JwtAuthGuard],
})
export class RulesModule {}
