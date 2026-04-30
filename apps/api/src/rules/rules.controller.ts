import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError, z } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import {
  listRuleExecutionsQuerySchema,
  ruleDraftBodySchema,
  ruleLifecycleBodySchema,
  rulePreviewBodySchema,
  ruleToggleBodySchema,
  ruleUpdateBodySchema,
} from "./rules.schema";
import { RulesService } from "./rules.service";

const idParamSchema = z.string().uuid();

@Controller("rules")
@UseGuards(JwtAuthGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  listRules() {
    return this.rules.listRules();
  }

  @Get("catalog")
  listBuilderCatalog() {
    return this.rules.getBuilderCatalog();
  }

  @Get("executions")
  async listExecutions(@Query() query: unknown) {
    try {
      const dto = listRuleExecutionsQuerySchema.parse(query);
      return await this.rules.listExecutions(dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post("evaluate")
  @HttpCode(HttpStatus.OK)
  evaluateEnabledRules(@CurrentUser() user: JwtPayload) {
    return this.rules.evaluateEnabledRules(user);
  }

  @Post("preview")
  @HttpCode(HttpStatus.OK)
  async previewRule(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const dto = rulePreviewBodySchema.parse(body);
      return await this.rules.previewRule(dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post()
  async createDraft(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      const dto = ruleDraftBodySchema.parse(body);
      return await this.rules.createDraft(dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async updateRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleUpdateBodySchema.parse(body);
      return await this.rules.updateRule(ruleId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/publish")
  async publishRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.publishRule(ruleId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/duplicate")
  async duplicateRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.duplicateRule(ruleId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/archive")
  async archiveRule(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleLifecycleBodySchema.parse(body);
      return await this.rules.archiveRule(ruleId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id/enabled")
  async setEnabled(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const ruleId = idParamSchema.parse(id);
      const dto = ruleToggleBodySchema.parse(body);
      return await this.rules.setEnabled(ruleId, dto, user);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
