import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CopilotAvailabilityService } from "../copilot/copilot-availability.service";
import { FilterOptionsModule } from "../filter-options/filter-options.module";
import { LlmModule } from "../llm/llm.module";
import { MlModule } from "../ml/ml.module";
import { FindingsParagraphController } from "./findings-paragraph.controller";
import { FindingsParagraphService } from "./findings-paragraph.service";

/**
 * `E1.9c` / ADR 0135 Amendment 8 (plan R-a, T3.4) — the AI-written findings
 * paragraph: `GET /ml/findings/paragraph` and its cache. Its own module so
 * `apps/api/src/ml/` stays read-only.
 *
 * `MlModule` exports `MlFindingsService` (the facts); `LlmModule` exports
 * `LlmResolver`; `FilterOptionsModule` exports `AssetFilterScopeService`;
 * `AuthModule` is imported for `JwtAuthGuard`. `CopilotAvailabilityService` is
 * **re-provided**, not imported: it is stateless with one `TENANT_DRIZZLE`
 * dependency (the reason `LlmModule` gives for `CredentialCryptoService`), and
 * importing `CopilotModule` would pull the whole copilot in. Nothing is
 * exported. API only: `AppModule` imports it, the worker does not.
 * `ml-findings-paragraph-module-wiring.spec.ts` holds the graph.
 */
@Module({
  imports: [AuthModule, FilterOptionsModule, MlModule, LlmModule],
  controllers: [FindingsParagraphController],
  providers: [FindingsParagraphService, CopilotAvailabilityService],
})
export class MlFindingsParagraphModule {}
