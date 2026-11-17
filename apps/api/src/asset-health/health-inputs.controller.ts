import { BadRequestException, Controller, ForbiddenException, Get, Param, Query, UseGuards } from "@nestjs/common";

import type { AssetHealthInputsResponse, HealthBadActorsResponse, JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { assertAssetIdParam } from "../common/guarded-point-ref";
import { DEFAULT_HEALTH_WINDOW_MINUTES } from "./asset-health.schema";
import { healthBadActorsQuerySchema } from "./health-inputs.schema";
import { HealthInputsService } from "./health-inputs.service";

/**
 * `E1.8a` / ADR 0050 Amendment 5 (plan T1.6, R-d) — the SOW §4.3 five inputs
 * of one asset, and the *Bad actors — advisory* read. Beside `E1.3`'s
 * `AssetHealthController`, never inside it: that controller and its two routes
 * do not change.
 *
 * **Both checks run before the service, in the handler's own body**
 * (`tests/e1.3-health-containment.test.ts`, `tests/e1.8-health-inputs-containment.test.ts`).
 * `HealthInputsService` takes asset ids, never a user, so it cannot be called
 * un-authorized by accident.
 */
@Controller("asset-health")
@UseGuards(JwtAuthGuard)
export class HealthInputsController {
  constructor(
    private readonly inputs: HealthInputsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * `GET /asset-health/assets/:assetId/inputs`: the asset id (400: not a UUID), then
   * `canReadAsset` (403), then the read. No query. Each fact that fails to read is `null`.
   */
  @Get("assets/:assetId/inputs")
  async forAsset(
    @CurrentUser() user: JwtPayload,
    @Param("assetId") assetIdParam: string,
  ): Promise<AssetHealthInputsResponse> {
    // Lower-cased: the reads return the lower-case `asset_id`, matched by plain string equality.
    const assetId = assertAssetIdParam(assetIdParam).toLowerCase();
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.inputs.forAsset(assetId, new Date());
  }

  /**
   * `GET /asset-health/bad-actors?organizationId=&locationId=`: the query (400), then the caller's
   * readable set, narrowed exactly as `GET /asset-health/summary` narrows it (R-d) — the lines are
   * repeated here on purpose, because the access check must sit in each handler's own body.
   * `readableAssetIdsInOrganization` is the readable set ANDed with the organization's assets, so
   * the id can only shrink the scope; an organization or location outside it answers the empty
   * card, never a 403. The rule score in the list is the default one-day score.
   */
  @Get("bad-actors")
  async badActors(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, unknown>,
  ): Promise<HealthBadActorsResponse> {
    const parsed = healthBadActorsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const assetIds = parsed.data.organizationId
      ? await this.accessControl.readableAssetIdsInOrganization(user, parsed.data.organizationId)
      : await this.accessControl.readableAssetIds(user);
    const location =
      parsed.data.locationId === undefined
        ? undefined
        : {
            id: parsed.data.locationId,
            readableLocationIds: await this.accessControl.readableLocationIds(user),
            readableOrganizationIds: await this.accessControl.readableOrganizationIds(user),
          };
    return this.inputs.badActors(assetIds, location, DEFAULT_HEALTH_WINDOW_MINUTES, new Date());
  }
}
