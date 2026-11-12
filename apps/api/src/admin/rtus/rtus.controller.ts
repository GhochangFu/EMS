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
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";
// `F3.86` PR 3a — the copilot catalog's bodies, by identity (`tests/f3.85-catalog-coverage`).
import { createRtuBodySchema, updateRtuBodySchema } from "@bms/shared";
// `F4.334` (ADR 0116 decision 4, plan R9): the RTU's payload format.
import { setRtuPayloadFormatBodySchema } from "@bms/shared";
// `F4.333` (ADR 0129 decision 2): the write-only credential replace.
import { replaceRtuCredentialsBodySchema } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema, parseActiveFilter } from "../admin.schema";
import { RtusCredentialsService } from "./rtus-credentials.service";
import { RtusAdminService } from "./rtus.service";

@Controller("admin/rtus")
@UseGuards(JwtAuthGuard)
export class RtusAdminController {
  constructor(
    private readonly service: RtusAdminService,
    private readonly credentials: RtusCredentialsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("locationId") locationId?: string,
    @Query("active") active?: string,
  ) {
    return this.service.list(
      user,
      locationId ? idParamSchema.parse(locationId) : undefined,
      parseActiveFilter(active),
    );
  }

  @Get(":id")
  async getById(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(user, idParamSchema.parse(id));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.create(user, createRtuBodySchema.parse(body));
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
        updateRtuBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Put(":id/payload-format")
  async setPayloadFormat(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      return await this.service.setPayloadFormat(
        user,
        idParamSchema.parse(id),
        setRtuPayloadFormatBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.333` (ADR 0129 decision 2) — replaces the RTU's broker credential. The
   * body is plaintext, encrypted before storage, never echoed, logged or
   * audited; the answer is the RTU row with `credentialsSet` only.
   */
  @Put(":id/credentials")
  async replaceCredentials(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.credentials.replace(user, idParamSchema.parse(id), replaceRtuCredentialsBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.deactivate(user, idParamSchema.parse(id));
  }

  @Post(":id/reactivate")
  @HttpCode(HttpStatus.OK)
  async reactivate(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.reactivate(user, idParamSchema.parse(id));
  }
}
