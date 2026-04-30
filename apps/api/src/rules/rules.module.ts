import { Module } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  controllers: [RulesController],
  providers: [RulesService, JwtAuthGuard],
})
export class RulesModule {}
