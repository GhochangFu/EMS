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
import { intersectReadable } from "../auth/asset-scope";
import { alarmAckBodySchema } from "./ack.schema";
import { alarmListQuerySchema, alarmSummaryQuerySchema } from "./alarm-list.schema";
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

/** A query schema's `ZodError` is the caller's mistake: a 400, as the body routes answer. */
function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.output<S> {
  try {
    return schema.parse(query) as z.output<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.flatten());
    }
    throw err;
  }
}

@Controller("alarms")
@UseGuards(JwtAuthGuard)
export class AlarmsController {
  constructor(
    private readonly alarms: AlarmsService,
    private readonly accessControl: AccessControlService,
    private readonly details: AlarmDetailsService,
    private readonly enrichment: AlarmEnrichmentService,
  ) {}

  /**
   * `F3.28` (ADR 0074 decision 4). The query is parsed before access control
   * runs, so a malformed one is a 400 that costs no scope read. A requested
   * `assetIds` is only ever **intersected** with the caller's readable set
   * (`intersectReadable`) — an id outside it is dropped, and an empty
   * intersection reaches the service as `[]`, which `withReadScope` answers
   * with an empty page, never with every row.
   */
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const dto = parseQuery(alarmListQuerySchema, query);
    return this.alarms.list({
      cursor: dto.cursor,
      limit: dto.limit ?? 20,
      state: dto.state,
      assetIds: intersectReadable(await this.accessControl.readableAssetIds(user), dto.assetIds),
    });
  }

  /**
   * `F3.28` (ADR 0074 decision 4, plan decision 7) — active alarm counts per
   * severity, for the same optional `assetIds` as `list`, intersected the
   * same way. Declared before every `:id` route so `summary` is never read as
   * an alarm id.
   */
  @Get("summary")
  async summary(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const dto = parseQuery(alarmSummaryQuerySchema, query);
    return this.alarms.activeCountsBySeverity(
      intersectReadable(await this.accessControl.readableAssetIds(user), dto.assetIds),
    );
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
