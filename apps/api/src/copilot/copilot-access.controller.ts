import { BadRequestException, Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { putCopilotAccessBodySchema } from "./copilot-access.schema";
import { CopilotAccessService } from "./copilot-access.service";

/** One organization's copilot switches and exceptions (`F3.85` PR 3, ADR 0099 decision 5). */
@Controller("admin/organizations/:orgId/copilot-access")
@UseGuards(JwtAuthGuard)
export class CopilotAccessController {
  constructor(private readonly service: CopilotAccessService) {}

  @Get()
  async get(@Param("orgId") orgId: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(user, idParamSchema.parse(orgId));
  }

  @Put()
  async put(@Param("orgId") orgId: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.put(user, idParamSchema.parse(orgId), putCopilotAccessBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
