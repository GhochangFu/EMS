import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import {
  createCalcParameterBodySchema,
  listCalcParametersQuerySchema,
  updateCalcParameterBodySchema,
} from "./calc-parameters.schema";
import { CalcParametersAdminService } from "./calc-parameters.service";

/**
 * `E4.1a` U8 — `/admin/calc-parameters` (ADR 0070 decision 2). Bodies and the
 * list query are parsed here; a `ZodError` becomes a 400 carrying
 * `err.flatten()`, as every sibling admin controller does.
 */
@Controller("admin/calc-parameters")
@UseGuards(JwtAuthGuard)
export class CalcParametersAdminController {
  constructor(private readonly service: CalcParametersAdminService) {}

  /**
   * **Declared before `GET :id`, and it has to stay there.** Nest matches
   * routes in declaration order, so a `GET :id` above this would swallow
   * `keys` as an id and answer 400 — the `asset-points.controller.ts` trap.
   */
  @Get("keys")
  async listKeys(@CurrentUser() user: JwtPayload) {
    return this.service.listKeys(user);
  }

  @Get()
  async list(@Query() query: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.list(user, listCalcParametersQuerySchema.parse(query));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createCalcParameterBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.update(
        user,
        idParamSchema.parse(id),
        updateCalcParameterBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    await this.service.remove(user, idParamSchema.parse(id));
  }
}
