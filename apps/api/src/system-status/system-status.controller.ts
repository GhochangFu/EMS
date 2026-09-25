import { Controller, Get, UseGuards } from "@nestjs/common";
import type { JwtPayload, SystemStatusResponse } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SystemStatusService } from "./system-status.service";

/**
 * `F3.30` (ADR 0075 decision 4) — `GET /api/v1/system/status`, the shell
 * footer's status and data-quality read.
 *
 * **`system`, not `health`.** `/health` is unauthenticated liveness for a load
 * balancer and stays so. This route answers tenant data — the data-quality
 * figure counts the caller's own assets — so it sits behind `JwtAuthGuard`
 * and is scoped by `readableAssetIds`. It is open to every role: no
 * master-data or operations-write gate, because every signed-in user sees the
 * footer.
 */
@Controller("system")
@UseGuards(JwtAuthGuard)
export class SystemStatusController {
  constructor(
    private readonly service: SystemStatusService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get("status")
  async status(@CurrentUser() user: JwtPayload): Promise<SystemStatusResponse> {
    return this.service.read(await this.accessControl.readableAssetIds(user));
  }
}
