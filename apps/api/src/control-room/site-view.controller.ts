import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SiteControlRoomViewService } from "./site-control-room-view.service";

/**
 * `F3.67` U4 / ADR 0076 decision 5 — the resolve read every later Control
 * Room row consumes (`F3.66`, `F3.68`, `F3.69`, `F3.70`): the effective view
 * for a site, with the fail-safe applied.
 *
 * Readable is "can read the site" (ADR 0076 Q14) —
 * `SiteControlRoomViewService.resolve` owns that rule (a global scope, or the
 * site among the caller's scoped locations) and answers a 404 for anything
 * else, so an out-of-scope site is indistinguishable from a missing one. No
 * body, no query — the id alone.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteViewController {
  constructor(private readonly service: SiteControlRoomViewService) {}

  @Get("sites/:locationId/view")
  async view(@Param("locationId") locationId: string, @CurrentUser() user: JwtPayload) {
    return this.service.resolve(user, idParamSchema.parse(locationId));
  }
}
