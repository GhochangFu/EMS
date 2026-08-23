import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { LogTransport } from "./log.transport";

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
 */
@Module({
  providers: [CredentialCryptoService, LogTransport],
  exports: [LogTransport],
})
export class NotificationsModule {}
