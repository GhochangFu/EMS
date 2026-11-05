import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import { createMimicLayoutBodySchema, putMimicLayoutBodySchema } from "@bms/shared";
import type { JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MimicLayoutPreviewService } from "./mimic-layout-preview.service";
import { mimicLayoutPreviewQuerySchema } from "./mimic-layouts.schema";
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
 * `F4.308`: `GET :id/preview` is read-only and for those two writer roles only
 * (ADR 0081 Amendment 2); `MimicLayoutPreviewService` owns its checks.
 */
@Controller("mimic-layouts")
@UseGuards(JwtAuthGuard)
export class MimicLayoutsController {
  constructor(
    private readonly service: MimicLayoutsService,
    private readonly previews: MimicLayoutPreviewService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.service.list(user);
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.service.get(user, parseBody(() => idParamSchema.parse(id)));
  }

  /**
   * `F4.308` (plan C1) — the stored layout resolved against one asset group, in the
   * `mimic-nodes` shape. `:id` and the `.strict()` query are each a 400 before any read.
   */
  @Get(":id/preview")
  async preview(@Param("id") id: string, @Query() query: unknown, @CurrentUser() user: JwtPayload) {
    const layoutId = parseBody(() => idParamSchema.parse(id));
    const { assetGroupId } = parseBody(() => mimicLayoutPreviewQuerySchema.parse(query));
    return this.previews.preview(user, layoutId, assetGroupId);
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
