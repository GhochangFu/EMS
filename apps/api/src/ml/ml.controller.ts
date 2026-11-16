import { Controller, ForbiddenException, Get, Param, UseGuards } from "@nestjs/common";

import type { ForecastListResponse, JwtPayload, PointForecastResponse } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { decodeBoundedPointRef } from "../common/guarded-point-ref";
import { MlForecastsService } from "./ml-forecasts.service";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c — the forecast reads. Access is the same
 * as for that asset's telemetry and needs no new permission: `canReadAsset`
 * for one point, `readableAssetIds` for the list. Reads only, no body and no
 * query, so no `*.schema.ts` entry, and nothing here belongs in the copilot
 * catalog. Each request reads the clock once (R2) and hands it down.
 */
@Controller("ml")
@UseGuards(JwtAuthGuard)
export class MlController {
  constructor(
    private readonly forecasts: MlForecastsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * `GET /ml/points/:pointRef/forecast`. In this order (S2): the bounded decode
   * (400: malformed, a non-UUID asset id, or a point key outside 1–128
   * characters), then `canReadAsset` (403), then the read. The decoded pair goes
   * to the service, never the raw string. A point with no current forecast is
   * 200 with `forecast: null`.
   */
  @Get("points/:pointRef/forecast")
  async pointForecast(
    @CurrentUser() user: JwtPayload,
    @Param("pointRef") pointRef: string,
  ): Promise<PointForecastResponse> {
    const point = decodeBoundedPointRef(pointRef);
    if (!(await this.accessControl.canReadAsset(user, point.assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.forecasts.current(point, new Date());
  }

  /** `GET /ml/forecasts`: one row per forecast point the caller can read. */
  @Get("forecasts")
  async list(@CurrentUser() user: JwtPayload): Promise<ForecastListResponse> {
    const assetIds = await this.accessControl.readableAssetIds(user);
    return this.forecasts.list(assetIds, new Date());
  }
}
