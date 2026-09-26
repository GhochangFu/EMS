import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import type { GeneratedSiteViewDto, JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { GeneratedSiteViewService } from "./generated-site-view.service";

/**
 * `F3.68` / ADR 0076 decision 7 — the generated site view's read: the domain
 * panels and asset cards of a site the caller can read. The guard, the path
 * and the id parsing follow F3.67's `SiteViewController`;
 * `GeneratedSiteViewService.forUser` owns the readable rule and its 404.
 *
 * No request body and no query, so no OpenAPI registry entry: the one path
 * parameter follows the `SiteViewController_view` rule in
 * `openapi-registry.ts`.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class GeneratedSiteViewController {
  constructor(private readonly service: GeneratedSiteViewService) {}

  @Get("sites/:locationId/generated")
  async generated(
    @Param("locationId") locationId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<GeneratedSiteViewDto> {
    return this.service.forUser(user, idParamSchema.parse(locationId));
  }
}
