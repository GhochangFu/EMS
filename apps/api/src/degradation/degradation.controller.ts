import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { DegradationResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { assertAssetIdParam } from "../common/guarded-point-ref";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { RateLimitClassOf } from "../rate-limit/rate-limit-class.decorator";
import { degradationQuerySchema } from "./degradation.schema";
import { DegradationService } from "./degradation.service";

/**
 * `E1.5a` / ADR 0138 (plan §4.1, T1.8, R-q) — the two degradation routes.
 * Reads only, no body; advisory only: nothing here raises an alarm, sends a
 * notification, opens a work order or changes a schedule, and nothing belongs
 * in the copilot catalog. Access is `narrow` (from `readableAssetIds`) for the
 * list and `canReadAsset` for one asset. Each request reads the clock once and
 * hands it down.
 *
 * `@Controller("")`, not a prefix: the routes sit under `/degradation` and
 * `/assets/:assetId/…`. The empty string, not a bare `@Controller()`, because
 * `tests/f3.85-audit-via-mark.test.ts` reads every controller's prefix as text.
 */
@Controller("")
@UseGuards(JwtAuthGuard)
export class DegradationController {
  constructor(
    private readonly degradation: DegradationService,
    private readonly assetFilterScope: AssetFilterScopeService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * `GET /degradation?organizationId=&locationId=`. In this order: the query
   * (400), then `narrow`, which starts from `readableAssetIds` and only narrows
   * (a key outside scope answers `assets: []`, never 403), then the service
   * with `narrow`'s value unchanged.
   *
   * `heavy` (12 a minute), not `read` (R-q): one call recomputes up to 200
   * assets over 28 days with no cache. The asset route reads one asset and
   * stays `read`.
   */
  @RateLimitClassOf("heavy")
  @Get("degradation")
  async list(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>): Promise<DegradationResponse> {
    const parsed = degradationQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const assetIds = await this.assetFilterScope.narrow(user, parsed.data);
    return this.degradation.list(assetIds, new Date());
  }

  /**
   * `GET /assets/:assetId/degradation`. In this order: the id (400: not a
   * UUID), `canReadAsset` (403), then the service with that one asset.
   */
  @Get("assets/:assetId/degradation")
  async forAsset(@CurrentUser() user: JwtPayload, @Param("assetId") assetIdParam: string): Promise<DegradationResponse> {
    const assetId = assertAssetIdParam(assetIdParam);
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.degradation.forAsset(assetId, new Date());
  }
}
