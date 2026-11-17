import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";

import type { JwtPayload, MlFindingsParagraphResponse } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetFilterScopeService } from "../filter-options/asset-filter-scope.service";
import { FindingsParagraphService } from "./findings-paragraph.service";
import { findingsParagraphQuerySchema } from "./findings-paragraph.schema";

/**
 * `E1.9c` / ADR 0135 Amendment 8 decision 10 (plan R-a, R-c, R-o, T3.4) —
 * `GET /ml/findings/paragraph?kind=&organizationId=&locationId=&assetGroupId=&assetId=`.
 * Its own module (`apps/api/src/ml/` stays read-only), the same `ml` prefix and
 * the same `JwtAuthGuard`; no role check (Q1: every reader of the facts). It
 * stays in the default `read` rate-limit class (R-o): the cache and the daily
 * cap bound the provider calls.
 *
 * In this order: the query (400 before anything else), then
 * `AssetFilterScopeService.narrow` — it starts from `readableAssetIds` and only
 * narrows — and its value reaches the service **unchanged**: the facts service
 * trusts the ids it is given (E1.9a security review). Then the request's one
 * clock. The answer never waits for the provider.
 */
@Controller("ml")
@UseGuards(JwtAuthGuard)
export class FindingsParagraphController {
  constructor(
    private readonly paragraphs: FindingsParagraphService,
    private readonly assetFilterScope: AssetFilterScopeService,
  ) {}

  @Get("findings/paragraph")
  async get(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>): Promise<MlFindingsParagraphResponse> {
    const parsed = findingsParagraphQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { kind, ...filter } = parsed.data;
    const assetIds = await this.assetFilterScope.narrow(user, filter);
    const narrowed = filter.locationId !== undefined || filter.assetGroupId !== undefined || filter.assetId !== undefined;
    return this.paragraphs.get(kind, assetIds, narrowed, new Date());
  }
}
