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

import { alarmAckBodySchema } from "./ack.schema";
import { AlarmsService } from "./alarms.service";

@Controller("alarms")
@UseGuards(JwtAuthGuard)
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Get()
  list(
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const limit = limitRaw ? Number(limitRaw) : 20;
    if (Number.isNaN(limit)) {
      throw new BadRequestException("Invalid limit");
    }
    return this.alarms.list({ cursor, limit });
  }

  @Post(":id/ack")
  @HttpCode(HttpStatus.OK)
  async acknowledge(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const dto = alarmAckBodySchema.parse(body);
      return this.alarms.acknowledge(id, user.sub, dto.reason);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
