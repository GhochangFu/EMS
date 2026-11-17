import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { AdvisoriesResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { assertAssetIdParam } from "../common/guarded-point-ref";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { RateLimitClassOf } from "../rate-limit/rate-limit-class.decorator";
import { advisoriesQuerySchema } from "./advisories.schema";
import { AdvisoriesService } from "./advisories.service";

/**
 * `E1.6a` / ADR 0137 decisions 5, 6 and 8 (plan T1.7) — the two advisory
 * routes. Reads only, no body; advisory only: nothing here raises an alarm,
 * sends a notification or opens a work order, and nothing belongs in the
 * copilot catalog. Access is the same as for the asset's cost and CO₂ points:
 * `narrow` (from `readableAssetIds`) for the list, `canReadAsset` for one
 * asset. Each request reads the clock once and hands it down.
 *
 * `@Controller("")`, not a prefix: the two routes sit under `/advisories` and
 * `/assets/:assetId/…`. The empty string, not a bare `@Controller()`, because
 * `tests/f3.85-audit-via-mark.test.ts` reads every controller's prefix as text.
 */
@Controller("")
@UseGuards(JwtAuthGuard)
export class AdvisoriesController {
  constructor(
    private readonly advisories: AdvisoriesService,
    private readonly assetFilterScope: AssetFilterScopeService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * `GET /advisories?organizationId=&locationId=`. In this order: the query
   * (400), then `narrow`, which starts from `readableAssetIds` and only narrows
   * (a key outside scope answers `advisories: []`, never 403), then the service
   * with `narrow`'s value unchanged.
   *
   * `heavy` (12 a minute), not `read`: one call recomputes up to 200 meters
   * over 35 days with no cache (E1.6a security review, L1). The page refetches
   * every 15 minutes, so a person never comes near the limit. The asset route
   * reads one meter and stays `read`.
   */
  @RateLimitClassOf("heavy")
  @Get("advisories")
  async list(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>): Promise<AdvisoriesResponse> {
    const parsed = advisoriesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const assetIds = await this.assetFilterScope.narrow(user, parsed.data);
    return this.advisories.list(assetIds, new Date());
  }

  /**
   * `GET /assets/:assetId/advisories`. In this order: the id (400: not a UUID),
   * `canReadAsset` (403), then the service with that one asset.
   */
  @Get("assets/:assetId/advisories")
  async forAsset(@CurrentUser() user: JwtPayload, @Param("assetId") assetIdParam: string): Promise<AdvisoriesResponse> {
    const assetId = assertAssetIdParam(assetIdParam);
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.advisories.forAsset(assetId, new Date());
  }
}
