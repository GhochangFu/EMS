import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { CredentialCryptoService } from "./credential-crypto.service";
import { CredentialRotationService } from "./credential-rotation.service";

/**
 * `E8.4` / ADR 0062 decision 6 — the root of the standalone context
 * `rotate-credentials.cli.ts` opens. Not imported by `AppModule`: rotation is
 * an operator command, never a request path.
 *
 * `CredentialCryptoService` is provided here for the same reason
 * `notifications.module.ts` provides its own — it is stateless and reads the
 * environment on every call — and its constructor is the refused boot on a
 * dead key window (decision 5, Amendment 1), which is why it must be
 * instantiated before the first row is read.
 */
@Module({
  imports: [DatabaseModule],
  providers: [CredentialCryptoService, CredentialRotationService],
})
export class CredentialRotationModule {}
