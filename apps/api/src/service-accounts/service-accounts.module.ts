import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";

import { AuthModule } from "../auth/auth.module";
import { ReadOnlyServiceTokenInterceptor } from "./read-only-token.interceptor";
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
  providers: [
    ServiceTokenVerifier,
    ServiceTokenListenerService,
    // Decision 12: a read-only token is refused every write (403), outside the guard (`F4.52`).
    { provide: APP_INTERCEPTOR, useClass: ReadOnlyServiceTokenInterceptor },
  ],
  exports: [ServiceTokenVerifier],
})
export class ServiceAccountsModule {}
