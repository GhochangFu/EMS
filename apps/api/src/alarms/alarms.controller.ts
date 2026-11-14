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
// F4.284 (ADR 0030): the two write bodies live in `@bms/shared`, the copilot catalog's exports by identity.
import { alarmAckBodySchema, alarmEnrichmentUpsertBodySchema, type JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { intersectReadable } from "../auth/asset-scope";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { alarmListQuerySchema, alarmSummaryQuerySchema } from "./alarm-list.schema";
import { locationFilter } from "./alarm-location-scope";
import { AlarmDetailsService } from "./alarm-details.service";
import { AlarmEnrichmentService } from "./alarm-enrichment.service";
import { AlarmsService } from "./alarms.service";

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
    // `F4.361` U4: appended last — three specs construct this controller by
    // hand, positionally. `assetGroupId`'s narrowing (ADR 0132 build note 3).
    private readonly assetFilterScope: AssetFilterScopeService,
  ) {}

  /**
   * `F4.361` U4 (ADR 0132 decision 3, build note 3): the caller's asset scope
   * for a list or summary read. With `assetGroupId` it is the group's members
   * inside the caller's readable set (`narrow` — an unreadable group is `[]`),
   * so device alarms follow as they do for `assetIds`; without one it is
   * `readableAssetIds`, untouched, and `narrow` never runs. A requested
   * `assetIds` is then intersected with that scope — it only narrows.
   */
  private async assetScope(
    user: JwtPayload,
    assetGroupId: string | undefined,
    assetIds: string[] | undefined,
  ): Promise<string[] | null> {
    const scope =
      assetGroupId === undefined
        ? await this.accessControl.readableAssetIds(user)
        : await this.assetFilterScope.narrow(user, { assetGroupId });
    return intersectReadable(scope, assetIds);
  }

  /**
   * `F3.28` (ADR 0074 decision 4). The query is parsed before access control
   * runs, so a malformed one is a 400 that costs no scope read. A requested
   * `assetIds` is only ever **intersected** with the caller's readable set
   * (`intersectReadable`) — an id outside it is dropped, and an empty
   * intersection reaches the service as `[]`, which `withReadScope` answers
   * with an empty page, never with every row.
   *
   * `F3.66` (step-5 fix): an optional `organizationId` narrows the read to
   * alarms on assets of that organization. It is ANDed onto the intersected
   * readable scope in the service, never used in place of it — so an
   * organization outside the caller's scope yields an empty result, not a 403
   * and not that organization's alarms. **This widens nothing only if the
   * intersection holds**: `assetIds` below must stay
   * `intersectReadable(readableAssetIds(user), …)` whether or not
   * `organizationId` is present — or, with `assetGroupId` (`F4.361`), the
   * intersection with `narrow`'s subset of that same readable set.
   *
   * `F4.357` U2 (ADR 0130 decision 15): an optional `locationId` narrows the
   * read to the alarms of that location and its sub-locations, the same way —
   * ANDed onto the intersected scope, so it **narrows and cannot widen**. A
   * node the caller cannot read answers empty (owner ruling P2), not 403.
   */
  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const dto = parseQuery(alarmListQuerySchema, query);
    return this.alarms.list({
      cursor: dto.cursor,
      limit: dto.limit ?? 20,
      state: dto.state,
      minSeverityRank: dto.minSeverityRank,
      assetIds: await this.assetScope(user, dto.assetGroupId, dto.assetIds),
      organizationId: dto.organizationId,
      severity: dto.severity,
      location: await locationFilter(this.accessControl, user, dto.locationId),
    });
  }

  /**
   * `F3.28` (ADR 0074 decision 4, plan decision 7) — active alarm counts per
   * severity, for the same optional `assetIds` as `list`, intersected the
   * same way. Declared before every `:id` route so `summary` is never read as
   * an alarm id.
   *
   * `F3.66` (step-5 fix): an optional `organizationId` narrows the read to
   * alarms on assets of that organization. It is ANDed onto the intersected
   * readable scope in the service, never used in place of it — so an
   * organization outside the caller's scope yields an empty result, not a 403
   * and not that organization's alarms. **This widens nothing only if the
   * intersection holds**: `assetIds` below must stay
   * `intersectReadable(readableAssetIds(user), …)` whether or not
   * `organizationId` is present — or, with `assetGroupId` (`F4.361`), the
   * intersection with `narrow`'s subset of that same readable set.
   *
   * `F4.357` U2 (ADR 0130 decision 15): an optional `locationId` narrows the
   * read to the alarms of that location and its sub-locations, the same way —
   * ANDed onto the intersected scope, so it **narrows and cannot widen**. A
   * node the caller cannot read answers empty (owner ruling P2), not 403.
   */
  @Get("summary")
  async summary(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const dto = parseQuery(alarmSummaryQuerySchema, query);
    return this.alarms.activeCountsBySeverity(
      await this.assetScope(user, dto.assetGroupId, dto.assetIds),
      dto.organizationId,
      await locationFilter(this.accessControl, user, dto.locationId),
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
