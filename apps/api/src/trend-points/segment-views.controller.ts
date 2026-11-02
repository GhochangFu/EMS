import { BadRequestException, Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";
import { siteSegmentViewsQuerySchema } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SiteSegmentViewsService } from "./segment-views.service";

/**
 * `F4.302` / ADR 0108 Amendment 4 item 4 — one segment of the Trends & Energy
 * tab, one batch read per (site, segment, point, range, compare). The path id
 * is parsed first (a `ZodError`, 400 through the global filter), then the
 * query (a 400 with `flatten()` that names the query shape only, so a bad query
 * on a foreign site leaks nothing); `SiteSegmentViewsService` owns the site
 * 404, the segment and point 404s, the range 400s and the scope. The response
 * is scope-filtered, hence `no-store`. Registry key
 * `SiteSegmentViewsController_forSite`.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteSegmentViewsController {
  constructor(private readonly service: SiteSegmentViewsService) {}

  @Get("sites/:locationId/segment-views")
  @Header("Cache-Control", "no-store")
  async forSite(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const id = idParamSchema.parse(locationId);
    const parsed = siteSegmentViewsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.service.forSite(user, id, parsed.data);
  }
}
