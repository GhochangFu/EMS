import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { alarmAckBodySchema } from "./ack.schema";
import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmsService } from "./alarms.service";

@Controller("alarms")
@UseGuards(JwtAuthGuard)
export class AlarmsController {
  constructor(
    private readonly alarms: AlarmsService,
    private readonly accessControl: AccessControlService,
    private readonly details: AlarmDetailsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const limit = limitRaw ? Number(limitRaw) : 20;
    if (Number.isNaN(limit)) {
      throw new BadRequestException("Invalid limit");
    }
    return this.alarms.list({
      cursor,
      limit,
      assetIds: await this.accessControl.readableAssetIds(user),
    });
  }

  /** ADR 0034 decision 5. A read, gated by asset scope like `list` — no
   * write-role check, unlike `acknowledge` and the enrichment write. */
  @Get(":id/details")
  async getDetails(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.details.get(id, await this.accessControl.readableAssetIds(user));
  }

  @Post(":id/ack")
  @HttpCode(HttpStatus.OK)
  async acknowledge(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const dto = alarmAckBodySchema.parse(body);
      return this.alarms.acknowledge(
        id,
        user,
        dto.reason,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
