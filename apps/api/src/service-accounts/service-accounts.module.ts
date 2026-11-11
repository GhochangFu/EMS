import { Global, Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ServiceTokenListenerService } from "./service-token-listener.service";
import { ServiceTokenVerifier } from "./service-token-verifier.service";

/**
 * `F4.17` / ADR 0125 Part B — service-account tokens. Global, so
 * `JwtAuthGuard` (declared in many modules) resolves the verifier wherever it
 * is built. API only: the worker serves no `/api/v1` route.
 *
 * `JwtAuthGuard` takes the verifier as `@Optional()`; without this module a
 * `bms_sat_` token is refused (fail closed), never accepted.
 * `tests/f4.17-service-token-wiring.test.ts` pins the import.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [ServiceTokenVerifier, ServiceTokenListenerService],
  exports: [ServiceTokenVerifier],
})
export class ServiceAccountsModule {}
