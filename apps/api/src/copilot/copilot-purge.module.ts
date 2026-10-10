import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { CopilotPurgeService } from "./copilot-purge.service";

/**
 * `F3.85` PR 5 / ADR 0099 decision 8 — the copilot history purge's module, a
 * leaf on the `RuleSweepModule` shape: it starts nothing in `onModuleInit`,
 * mounts no controller and imports `DatabaseModule` only (the two pools
 * `CopilotPurgeService` injects).
 *
 * Imported by `WorkerModule` and by nothing in the API: `CopilotModule`
 * (routes, the change interceptor, the LLM path) never reaches the worker,
 * and this module never reaches `CopilotModule`. `tests/f4.24` rule 8 is the
 * gate — no `copilot/` file in the worker's closure except the purge leaves.
 */
@Module({
  imports: [DatabaseModule],
  providers: [CopilotPurgeService],
  exports: [CopilotPurgeService],
})
export class CopilotPurgeModule {}
