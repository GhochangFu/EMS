import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";

import type { JwtPayload, MlFindingsSummaryResponse } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetFilterScopeService, type AssetScopeFilter } from "../filter-options/asset-filter-scope.service";
import { MlFindingsService } from "./ml-findings.service";
import { mlFindingsSummaryQuerySchema } from "./ml.schema";

/** R-r: a location, asset group or asset narrows the request; an organization alone does not. */
const isNarrowed = (filter: AssetScopeFilter): boolean =>
  filter.locationId !== undefined || filter.assetGroupId !== undefined || filter.assetId !== undefined;

/**
 * `E1.9a` / ADR 0135 Amendment 8 decision 10 (plan R-a, R-b, R-c) — the two
 * findings summary routes: fixed fact sentences per organization, no LLM. Their
 * own controller file, so `MlController` keeps its five routes; the same `ml`
 * prefix and the same `JwtAuthGuard`. Reads only, no body; the query is the four
 * scope keys (`mlFindingsSummaryQuerySchema`, registered as
 * `MlFindingsController_forecastSummary` and `_anomalySummary`).
 *
 * In this order: the query (400), then `AssetFilterScopeService.narrow`, which
 * starts from `readableAssetIds` and only narrows (a key outside scope answers
 * `cards: []`, never 403), then the service with `narrow`'s value unchanged and
 * the request's one clock. Nothing here belongs in the copilot catalog.
 */
@Controller("ml")
@UseGuards(JwtAuthGuard)
export class MlFindingsController {
  constructor(
    private readonly findings: MlFindingsService,
    private readonly assetFilterScope: AssetFilterScopeService,
  ) {}

  /** `GET /ml/forecasts/summary?organizationId=&locationId=&assetGroupId=&assetId=`. */
  @Get("forecasts/summary")
  async forecastSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, unknown>,
  ): Promise<MlFindingsSummaryResponse> {
    const parsed = mlFindingsSummaryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const assetIds = await this.assetFilterScope.narrow(user, parsed.data);
    return this.findings.forecastSummary(assetIds, isNarrowed(parsed.data), new Date());
  }

  /** `GET /ml/anomalies/summary?organizationId=&locationId=&assetGroupId=&assetId=`. */
  @Get("anomalies/summary")
  async anomalySummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: Record<string, unknown>,
  ): Promise<MlFindingsSummaryResponse> {
    const parsed = mlFindingsSummaryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const assetIds = await this.assetFilterScope.narrow(user, parsed.data);
    return this.findings.anomalySummary(assetIds, isNarrowed(parsed.data), new Date());
  }
}
