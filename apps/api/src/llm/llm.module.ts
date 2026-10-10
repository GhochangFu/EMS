import { Module } from "@nestjs/common";

import { CredentialCryptoService } from "../security/credential-crypto.service";
import { LlmResolver } from "./llm-resolver";

/**
 * The generic LLM core (F3.85, ADR 0099): the provider port, the adapters, the
 * factory and the per-organization resolver, shared by the onboarding agent and
 * the admin copilot.
 *
 * `CredentialCryptoService` is re-provided here, not imported: it is stateless
 * (it reads `CREDENTIAL_ENCRYPTION_KEY` per call), the same reason
 * `notifications-core.module.ts` gives. The drizzle tokens come from a
 * `@Global()` module, so this module declares no `imports`.
 */
@Module({
  providers: [CredentialCryptoService, LlmResolver],
  exports: [LlmResolver],
})
export class LlmModule {}
