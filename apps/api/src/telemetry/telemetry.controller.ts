import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { decodePointRefParam, type JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TelemetryService } from "./telemetry.service";

@Controller("telemetry")
@UseGuards(JwtAuthGuard)
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Historical window for charts and TanStack Query seed data. */
  @Get("points/:pointRef/recent")
  async recent(
    @CurrentUser() user: JwtPayload,
    @Param("pointRef") pointRef: string,
    @Query("window") window?: string,
  ) {
    const { assetId } = decodePointRefParam(pointRef);
    if (!(await this.accessControl.canReadAsset(user, assetId))) {
      throw new ForbiddenException("Asset is outside your access scope");
    }
    return this.telemetry.recentForPoint(pointRef, window);
  }
}
