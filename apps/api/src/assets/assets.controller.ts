import { Controller, Get, UseGuards } from "@nestjs/common";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetsService } from "./assets.service";

@Controller("assets")
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /** Lists seeded / configured assets for telemetry binding. */
  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.assets.listAll(await this.accessControl.readableAssetIds(user));
  }
}
