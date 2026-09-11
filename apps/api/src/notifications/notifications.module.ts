import { Module } from "@nestjs/common";

import {
  EscalationDefaultsController,
  EscalationProfilesController,
} from "./escalation-profiles.controller";
import { EscalationProfilesService } from "./escalation-profiles.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsCoreModule } from "./notifications-core.module";

/**
 * `F3.8` notifications (ADR 0041) — the HTTP surface.
 *
 * Since `F3.11` (ADR 0064 Amendment 1 A1) the providers live in
 * `NotificationsCoreModule`, imported and re-exported here, so the worker can
 * dispatch through `NotificationsService` without this module's three
 * controllers — each behind `JwtAuthGuard`, whose `JwtService` only
 * `AuthModule` loads. This module keeps the controllers and the one provider
 * only they inject, `EscalationProfilesService`; `CredentialCryptoService`
 * and the transports moved with the core, for the reasons its docblock gives.
 *
 * Registered in `app.module.ts` so the routes are mounted; `AlarmsModule` and
 * `RulesModule` import it and resolve `NotificationsService` and
 * `ChannelsService` through the re-export exactly as before the carve.
 *
 * **`F3.10` U8 added the escalation-profile surface and this module still
 * imports nothing from alarms or rules** (plan D11), which is what keeps the
 * module edge acyclic — `alarms.module.ts:17-19` records the same constraint
 * from the other side. The severity on `alarm_escalation_defaults` is
 * validated by its foreign key to `bms.alarm_severities`, so no
 * `VocabulariesModule` is needed; `AccessControlService` and the two drizzle
 * tokens come from `@Global()` modules, exactly as `ChannelsService` already
 * gets them.
 */
@Module({
  imports: [NotificationsCoreModule],
  controllers: [
    NotificationsController,
    EscalationProfilesController,
    EscalationDefaultsController,
  ],
  providers: [EscalationProfilesService],
  exports: [NotificationsCoreModule],
})
export class NotificationsModule {}
