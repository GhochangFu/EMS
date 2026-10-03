import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { putAiAssistantSettingsBodySchema, testAiAssistantBodySchema } from "./ai-assistant-settings.schema";
import { AiAssistantSettingsService } from "./ai-assistant-settings.service";

/** One organization's onboarding-agent provider, model and key (`F3.21`, ADR 0090 Amendment 1 A5). */
@Controller("admin/organizations/:orgId/ai-assistant")
@UseGuards(JwtAuthGuard)
export class AiAssistantSettingsController {
  constructor(private readonly service: AiAssistantSettingsService) {}

  @Get()
  async get(@Param("orgId") orgId: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(user, idParamSchema.parse(orgId));
  }

  @Put()
  async put(@Param("orgId") orgId: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.put(user, idParamSchema.parse(orgId), putAiAssistantSettingsBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Delete()
  async remove(@Param("orgId") orgId: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user, idParamSchema.parse(orgId));
  }

  @Post("test")
  @HttpCode(HttpStatus.OK)
  async test(@Param("orgId") orgId: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.test(user, idParamSchema.parse(orgId), testAiAssistantBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
