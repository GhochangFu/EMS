import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { VocabulariesModule } from "../vocabularies/vocabularies.module";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  imports: [VocabulariesModule],
  controllers: [RulesController],
  providers: [RulesService, JwtAuthGuard],
})
export class RulesModule {}
