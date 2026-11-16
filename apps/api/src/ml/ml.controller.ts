import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { ForecastListResponse, JwtPayload, PastForecastResponse, PointForecastResponse } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { decodeBoundedPointRef } from "../common/guarded-point-ref";
import { MlForecastsService } from "./ml-forecasts.service";
import { pastForecastQuerySchema } from "./ml.schema";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c — the forecast reads. Access is the same
 * as for that asset's telemetry and needs no new permission: `canReadAsset`
 * for one point, `readableAssetIds` for the list. Reads only, no body; the one
 * query, the past forecast's `from`/`to` window (`E1.4e`, Amendment 4), is
 * `pastForecastQuerySchema` in `ml.schema.ts`, registered as
 * `MlController_pastForecast`. Nothing here belongs in the copilot catalog.
 * Each request reads the clock once (R2) and hands it down.
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

  /**
   * `GET /ml/points/:pointRef/forecast/past?from=&to=` (`E1.4e`, ADR 0135
   * Amendment 4): for each past hour of the window, the p50 forecast made 1 hour
   * ahead, drawn beside the actual line. In this order: the bounded decode (400),
   * the query (400: missing, not an offset ISO instant, `from` not before `to`,
   * longer than the span cap, or an unknown key), `canReadAsset` (403), the read.
   * Four segments, so it cannot collide with `points/:pointRef/forecast`.
   */
  @Get("points/:pointRef/forecast/past")
  async pastForecast(
    @CurrentUser() user: JwtPayload,
    @Param("pointRef") pointRef: string,
    @Query() query: Record<string, unknown>,
  ): Promise<PastForecastResponse> {
    const point = decodeBoundedPointRef(pointRef);
    const parsed = pastForecastQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    if (!(await this.accessControl.canReadAsset(user, point.assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    const window = { from: new Date(parsed.data.from), to: new Date(parsed.data.to) };
    return this.forecasts.past(point, window, new Date());
  }

  /** `GET /ml/forecasts`: one row per forecast point the caller can read. */
  @Get("forecasts")
  async list(@CurrentUser() user: JwtPayload): Promise<ForecastListResponse> {
    const assetIds = await this.accessControl.readableAssetIds(user);
    return this.forecasts.list(assetIds, new Date());
  }
}
