import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { VocabulariesController } from "./vocabularies.controller";
import { VocabulariesService } from "./vocabularies.service";

/**
 * Exports `VocabulariesService` because the vocabulary check belongs at every
 * write boundary that stores one of these codes, not just at the read endpoint:
 * assets, onboarding commit, asset templates and rules all import it (ADR 0031
 * Amendment 1).
 */
@Module({
  controllers: [VocabulariesController],
  providers: [VocabulariesService, JwtAuthGuard],
  exports: [VocabulariesService],
})
export class VocabulariesModule {}
