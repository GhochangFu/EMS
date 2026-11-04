import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { idParamSchema } from "../admin.schema";
import { assetPointCalcOverrideBodySchema, calcPointKeyParamSchema, calcPointSetBodySchema } from "@bms/shared";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F2.6` — per-asset calc overrides (ADR 0039 decision 8: "two surfaces, each
 * where its subject is"). The subject here is an asset, so the routes hang off
 * `admin/assets/:assetId`, not off `admin/asset-points`.
 *
 * A separate controller from `AssetPointsAdminController` for the same reason
 * the service is separate: that one is about telemetry mapping, this is about
 * calc configuration. They share a table, not a subject.
 *
 * **`F4.311` (ADR 0109 decision 4) — every route dispatches on the asset's
 * kind.** An asset pinned to a template version keeps today's override
 * meaning, unchanged; an asset with no template serves its standalone
 * calculated points through `CalcPointStandaloneService`. Each kind parses its
 * own body: the override's nullable "inherit" columns, or the standalone
 * point's required ones.
 */
@Controller("admin/assets")
@UseGuards(JwtAuthGuard)
export class AssetPointCalcOverrideController {
  constructor(
    private readonly service: AssetPointCalcOverrideService,
    private readonly standalone: CalcPointStandaloneService,
  ) {}

  /** Every calc point of this asset: template/override/effective, or the standalone points. */
  @Get(":assetId/calc-points")
  async list(@Param("assetId") assetId: string, @CurrentUser() user: JwtPayload) {
    const id = idParamSchema.parse(assetId);
    const { kind } = await this.standalone.kindOf(user, id);
    return kind === "standalone" ? this.standalone.list(user, id) : this.service.listCalcPoints(user, id);
  }

  /**
   * `PUT`, not `PATCH`: the body states the whole override, and `null` per
   * column means "inherit". A partial update would need a second spelling of
   * "leave this alone" that the server could not tell from "clear this one".
   * On a template-less asset it creates or replaces the standalone point, and
   * every calc field is required (ADR 0109 decision 1).
   *
   * `200` rather than `201` even when it creates the `asset_points` row — the
   * subject is the override, which is being set either way, and a client that
   * branched on the status would be branching on whether a row it never asked
   * about happened to exist.
   */
  @Put(":assetId/calc-points/:pointKey")
  @HttpCode(HttpStatus.OK)
  async set(
    @Param("assetId") assetId: string,
    @Param("pointKey") pointKey: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const id = idParamSchema.parse(assetId);
      const key = calcPointKeyParamSchema.parse(pointKey);
      const { kind } = await this.standalone.kindOf(user, id);
      return kind === "standalone"
        ? await this.standalone.set(user, id, key, calcPointSetBodySchema.parse(body))
        : await this.service.setOverride(user, id, key, assetPointCalcOverrideBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * Template asset: clears all five columns back to "inherit", never deleting
   * the row. Template-less asset: removes the standalone point (its stored
   * telemetry stays).
   */
  @Delete(":assetId/calc-points/:pointKey")
  @HttpCode(HttpStatus.OK)
  async clear(
    @Param("assetId") assetId: string,
    @Param("pointKey") pointKey: string,
    @CurrentUser() user: JwtPayload,
  ) {
    try {
      const id = idParamSchema.parse(assetId);
      const key = calcPointKeyParamSchema.parse(pointKey);
      const { kind } = await this.standalone.kindOf(user, id);
      return kind === "standalone"
        ? await this.standalone.remove(user, id, key)
        : await this.service.clearOverride(user, id, key);
    } catch (err) {
      // Matches `set` above. Without it a malformed path parameter throws a
      // ZodError past the filter and surfaces as a 500, which would make this
      // route worse than the unparsed version it replaced.
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
