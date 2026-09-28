import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { createMimicLayoutBodySchema, putMimicLayoutBodySchema } from "./mimic-layouts.schema";
import { MimicLayoutsService } from "./mimic-layouts.service";

/** A body refused by Zod is the caller's 400, with the flattened issues. */
function parseBody<T>(parse: () => T): T {
  try {
    return parse();
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}

/**
 * `/api/v1/mimic-layouts` — the organization's plant mimic library (`F3.32c`,
 * ADR 0081 decision 3). Any authenticated role reads; `admin` and
 * `organization_admin` write. The service owns every access decision.
 */
@Controller("mimic-layouts")
@UseGuards(JwtAuthGuard)
export class MimicLayoutsController {
  constructor(private readonly service: MimicLayoutsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(user, parseBody(() => idParamSchema.parse(id)));
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    return this.service.create(user, parseBody(() => createMimicLayoutBodySchema.parse(body)));
  }

  @Put(":id")
  async replace(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: JwtPayload) {
    const layoutId = parseBody(() => idParamSchema.parse(id));
    return this.service.replace(user, layoutId, parseBody(() => putMimicLayoutBodySchema.parse(body)));
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(user, parseBody(() => idParamSchema.parse(id)));
  }
}
