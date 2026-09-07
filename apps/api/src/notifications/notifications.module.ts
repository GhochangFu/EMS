import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { ChannelsService } from "./channels.service";
import { EmailTransport } from "./email.transport";
import {
  EscalationDefaultsController,
  EscalationProfilesController,
} from "./escalation-profiles.controller";
import { EscalationProfilesService } from "./escalation-profiles.service";
import { LogTransport } from "./log.transport";
import { NotificationsController } from "./notifications.controller";
import { NOTIFICATIONS_CONFIG, notificationsConfig } from "./notifications.config";
import { NotificationsService } from "./notifications.service";
import { WebhookTransport } from "./webhook.transport";

/**
 * `F3.8` notifications (ADR 0041).
 *
 * `CredentialCryptoService` is provided here rather than imported.
 * `admin.module.ts` provides it too and does not export it, and that is not a
 * duplicated singleton in any meaningful sense: the service is stateless — it
 * reads `CREDENTIAL_ENCRYPTION_KEY` from the environment on each call — so a
 * second instance holds no second copy of anything. Exporting it from
 * `AdminModule` to share one instance would make this module depend on the
 * whole admin surface for one crypto helper.
 *
 * Grows through U4–U7 with the two real transports, the dispatcher and the
 * controller. Registered in `app.module.ts` from this unit onward so the
 * providers are wired before anything depends on them.
 *
 * **`F3.10` U8 adds the escalation-profile surface and still declares no
 * `imports`** (plan D11), which is what keeps the module edge acyclic —
 * `alarms.module.ts:17-19` records the same constraint from the other side.
 * The severity on `alarm_escalation_defaults` is validated by its foreign key
 * to `bms.alarm_severities`, so no `VocabulariesModule` is needed;
 * `AccessControlService` and the two drizzle tokens come from `@Global()`
 * modules, exactly as `ChannelsService` already gets them.
 */
@Module({
  controllers: [
    NotificationsController,
    EscalationProfilesController,
    EscalationDefaultsController,
  ],
  providers: [
    CredentialCryptoService,
    ChannelsService,
    EscalationProfilesService,
    NotificationsService,
    { provide: NOTIFICATIONS_CONFIG, useValue: notificationsConfig },
    LogTransport,
    // A factory, not the bare class. `WebhookTransport`'s constructor takes an
    // injectable-deps object with a default — which the tests use to stub
    // `fetch` and the resolver — and Nest's reflection would see the parameter
    // as `Object`, fail to resolve a provider for it, and refuse to start.
    // The factory says "construct it with its defaults" in one line.
    { provide: WebhookTransport, useFactory: () => new WebhookTransport() },
    // Same reason, and one more: EmailTransport builds its nodemailer
    // transporter in the constructor ONLY when `SMTP_HOST` is set, so an
    // unconfigured deployment constructs no SMTP client at all.
    { provide: EmailTransport, useFactory: () => new EmailTransport() },
  ],
  exports: [NotificationsService, ChannelsService],
})
export class NotificationsModule {}
