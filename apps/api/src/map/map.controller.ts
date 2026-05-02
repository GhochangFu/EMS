import { Controller, Get, UseGuards } from "@nestjs/common";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MapService } from "./map.service";

@Controller("map")
@UseGuards(JwtAuthGuard)
export class MapController {
  constructor(
    private readonly map: MapService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get("sites")
  async sites(@CurrentUser() user: JwtPayload) {
    const currentUser = await this.accessControl.currentUser(user);
    return this.map.sitesLive({
      allowedSiteNames:
        currentUser.scope.kind === "global"
          ? null
          : currentUser.scope.locations.map((location) => location.name),
      assetIds:
        currentUser.scope.kind === "global" ? null : currentUser.scope.assetIds,
    });
  }
}
