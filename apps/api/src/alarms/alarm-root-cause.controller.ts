import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import type { AlarmRootCauseSuggestionsResponse, JwtPayload } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

import { AlarmRootCauseService } from "./alarm-root-cause.service";

/**
 * `E2.3` / ADR 0136 — the root-cause suggestions route, in its own controller
 * (plan R-b) so `AlarmsController` and its three positional constructions stay
 * as they are.
 *
 * Order: the id (a `ZodError`, which the global `ZodErrorFilter` answers 400) →
 * `readableAssetIds` → the service, whose first step is `/details`' own gate.
 * **No write-role check**: it is a read, and a `viewer` reads it (ADR 0136 Q5).
 * Nothing is exported from the module for it: the copilot must not reach it.
 */
@Controller("alarms")
@UseGuards(JwtAuthGuard)
export class AlarmRootCauseController {
  constructor(
    private readonly service: AlarmRootCauseService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get(":id/root-cause-suggestions")
  async rootCauseSuggestions(
    @Param("id") id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<AlarmRootCauseSuggestionsResponse> {
    const alarmId = idParamSchema.parse(id);
    const assetIds = await this.accessControl.readableAssetIds(user);
    return this.service.get(alarmId, assetIds, new Date());
  }
}
