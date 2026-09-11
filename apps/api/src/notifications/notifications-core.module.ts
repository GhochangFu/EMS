import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { ChannelsService } from "./channels.service";
import { EmailTransport } from "./email.transport";
import { LogTransport } from "./log.transport";
import { NOTIFICATIONS_CONFIG, notificationsConfig } from "./notifications.config";
import { NotificationsService } from "./notifications.service";
import { WebhookTransport } from "./webhook.transport";

/**
 * `F3.11` / ADR 0064 Amendment 1 A1 — the notification providers on their
 * own, with no controller and no import, so the worker can dispatch a
 * sweep-raised alarm's notification without `NotificationsModule`.
 *
 * `NotificationsModule` declares three controllers, each behind
 * `JwtAuthGuard`, and the guard injects `JwtService` from the `JwtModule`
 * only `AuthModule` loads. A worker importing the full module would have
 * either failed DI at boot or mounted `/notifications` and
 * `/admin/escalation-*` on `WORKER_PORT`. This module is the providers at
 * `notifications.module.ts` minus `EscalationProfilesService`, which only the
 * escalation controllers inject and which stays with them.
 *
 * `NotificationsModule` imports and re-exports this module, so `AlarmsModule`
 * and `RulesModule` resolve the same `NotificationsService` and
 * `ChannelsService` instances they did before the carve. `AccessControlService`
 * (injected by `ChannelsService`) and the drizzle tokens come from
 * `@Global()` modules, so this module declares no `imports`
 * and the edge stays acyclic — `alarms.module.ts` records the same constraint.
 *
 * `CredentialCryptoService` is provided here rather than imported, for the
 * reason `notifications.module.ts` gave when it held it: the service is
 * stateless (it reads `CREDENTIAL_ENCRYPTION_KEY` per call), so a second
 * instance holds no second copy of anything.
 */
@Module({
  providers: [
    CredentialCryptoService,
    ChannelsService,
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
export class NotificationsCoreModule {}
