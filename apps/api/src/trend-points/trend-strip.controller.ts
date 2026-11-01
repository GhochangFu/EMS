import { BadRequestException, Controller, Get, Header, Param, Query, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";
import { siteTrendStripQuerySchema } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.301` / ADR 0108 Amendment 2 item 3 — the Control Room trend strip, one
 * batch read per (tab, range). The path id is parsed first (a `ZodError`, 400
 * through the global filter), then the query (a 400 with `flatten()` that
 * names the query shape only, so a bad query on a foreign site leaks nothing);
 * `SiteTrendStripService` owns the site 404, the group 404 and the scope. The
 * response is scope-filtered, hence `no-store`.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteTrendStripController {
  constructor(private readonly service: SiteTrendStripService) {}

  @Get("sites/:locationId/trend-strip")
  @Header("Cache-Control", "no-store")
  async forSite(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const id = idParamSchema.parse(locationId);
    const parsed = siteTrendStripQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.service.forSite(user, id, parsed.data);
  }
}
