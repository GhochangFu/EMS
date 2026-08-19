import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { z, ZodError } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { alarmAckBodySchema } from "./ack.schema";
import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmsService } from "./alarms.service";
import { alarmEnrichmentUpsertBodySchema } from "./enrichment.schema";

/**
 * Security review finding: the two new routes below passed `id` straight to
 * a `uuid` column with no shape check, so a non-UUID id reached Postgres
 * `22P02` and returned a 500. `list`/`acknowledge` share this gap but predate
 * this ADR, so they are out of scope here; `../admin/admin.schema`'s
 * `idParamSchema` is the same check, kept local rather than reached for
 * across an admin/non-admin module boundary.
 */
const alarmIdParamSchema = z.string().uuid();

@Controller("alarms")
@UseGuards(JwtAuthGuard)
export class AlarmsController {
  constructor(
    private readonly alarms: AlarmsService,
    private readonly accessControl: AccessControlService,
    private readonly details: AlarmDetailsService,
    private readonly enrichment: AlarmEnrichmentService,
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
    try {
      const alarmId = alarmIdParamSchema.parse(id);
      return await this.details.get(alarmId, await this.accessControl.readableAssetIds(user));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
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

  /** ADR 0034 decision 6. Returns the freshly computed details response so
   * the browser needs no second round trip. */
  @Put(":id/enrichment")
  async upsertEnrichment(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.accessControl.assertOperationsWriteRole(user, "operational");
    try {
      const alarmId = alarmIdParamSchema.parse(id);
      const dto = alarmEnrichmentUpsertBodySchema.parse(body);
      const assetIds = await this.accessControl.readableAssetIds(user);
      await this.enrichment.upsert(alarmId, user, dto, assetIds);
      return await this.details.get(alarmId, assetIds);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
