import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { mapSitesQuerySchema } from "./map.schema";
import { MapService } from "./map.service";

@Controller("map")
@UseGuards(JwtAuthGuard)
export class MapController {
  constructor(
    private readonly map: MapService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * The org map's pins: `/map` and the Control Room organization map read this one route (`F2.10`
   * B12). `parentLocationId` narrows to a node's subtree; a malformed id or an unknown key is a 400.
   */
  @Get("sites")
  async sites(@CurrentUser() user: JwtPayload, @Query() query: Record<string, unknown>) {
    const parsed = mapSitesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const currentUser = await this.accessControl.currentUser(user);
    return this.map.sitesLive({
      allowedSiteNames:
        currentUser.scope.kind === "global"
          ? null
          : currentUser.scope.locations.map((location) => location.name),
      // F3.79 security review: a pin that joins a location is scoped by its id, not its name.
      allowedLocationIds:
        currentUser.scope.kind === "global"
          ? null
          : currentUser.scope.locations.map((location) => location.id),
      assetIds:
        currentUser.scope.kind === "global" ? null : currentUser.scope.assetIds,
      parentLocationId: parsed.data.parentLocationId ?? null,
    });
  }
}
