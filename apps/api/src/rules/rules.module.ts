import { Module } from "@nestjs/common";

import { AlarmsModule } from "../alarms/alarms.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { EvaluateThrottle } from "./evaluate-throttle";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  // `AlarmsModule → TelemetryModule` only, so this edge is acyclic — checked
  // before adding it, not assumed (F3.6 task 5).
  // `NotificationsModule` imports nothing from rules, so this edge is acyclic —
  // checked before adding it (F3.8 U7), the same way the AlarmsModule edge was.
  imports: [VocabulariesModule, AlarmsModule, NotificationsModule],
  controllers: [RulesController],
  // `EvaluateThrottle` holds the evaluate-now window in a `Map` on the
  // instance, so it must stay a **singleton** (the default scope). Making it
  // request-scoped would hand every request a fresh Map and throttle nothing,
  // and no unit test in this repository could see that.
  providers: [RulesService, JwtAuthGuard, EvaluateThrottle],
})
export class RulesModule {}
