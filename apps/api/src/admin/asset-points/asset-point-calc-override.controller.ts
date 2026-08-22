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
import { assetPointCalcOverrideBodySchema } from "./asset-point-calc-override.schema";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";

/**
 * `F2.6` — per-asset calc overrides (ADR 0039 decision 8: "two surfaces, each
 * where its subject is"). The subject here is an asset, so the routes hang off
 * `admin/assets/:assetId`, not off `admin/asset-points`.
 *
 * A separate controller from `AssetPointsAdminController` for the same reason
 * the service is separate: that one is about telemetry mapping, this is about
 * calc configuration. They share a table, not a subject.
 */
@Controller("admin/assets")
@UseGuards(JwtAuthGuard)
export class AssetPointCalcOverrideController {
  constructor(private readonly service: AssetPointCalcOverrideService) {}

  /** Every derived point of this asset: template value, override, effective. */
  @Get(":assetId/calc-points")
  async list(@Param("assetId") assetId: string, @CurrentUser() user: JwtPayload) {
    return this.service.listCalcPoints(user, idParamSchema.parse(assetId));
  }

  /**
   * `PUT`, not `PATCH`: the body states the whole override, and `null` per
   * column means "inherit". A partial update would need a second spelling of
   * "leave this alone" that the server could not tell from "clear this one".
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
      return await this.service.setOverride(
        user,
        idParamSchema.parse(assetId),
        pointKey,
        assetPointCalcOverrideBodySchema.parse(body),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /** Clears all five columns back to "inherit". Never deletes the row. */
  @Delete(":assetId/calc-points/:pointKey")
  @HttpCode(HttpStatus.OK)
  async clear(
    @Param("assetId") assetId: string,
    @Param("pointKey") pointKey: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.clearOverride(user, idParamSchema.parse(assetId), pointKey);
  }
}
