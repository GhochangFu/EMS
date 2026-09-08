import { Controller, Get, UseGuards } from "@nestjs/common";

import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AlarmKbService } from "./alarm-kb.service";

/**
 * `GET /api/v1/alarm-kb` — the browsable alarm philosophy knowledge base
 * (`E2.2` PR 2, ADR 0059 decision 4).
 *
 * **Ruling Q0b: every signed-in user who can see alarms may open this, `viewer`
 * included.** So the only gate is `JwtAuthGuard` plus the organization scope —
 * there is deliberately **no** `assertMasterDataRole` and **no**
 * `assertOperationsWriteRole` here, and that absence is load-bearing rather
 * than an omission:
 *
 * - A `viewer` already reads these same four fields on the alarm details panel
 *   (ADR 0059 decision 2). Gating the KB would refuse in one place what the
 *   product hands out in another.
 * - The template authoring screen's Alarms tab shows this content too, but it
 *   *is* master-data gated — which is precisely why the operator and the
 *   technician cannot read it today, and why this row exists.
 *
 * `tests/e2.2-alarm-kb-route-gate.test.ts` holds that absence, so a later
 * well-meant tightening fails a test rather than silently closing the surface
 * the row was built to open.
 *
 * No route parameters, no body, no pagination: the list is one row per
 * published asset class in the caller's organizations — 21 on the current dev
 * database — and paginating a reference list that small would be ceremony.
 */
@Controller("alarm-kb")
@UseGuards(JwtAuthGuard)
export class AlarmKbController {
  constructor(
    private readonly kb: AlarmKbService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.kb.list(await this.accessControl.readableOrganizationIds(user));
  }
}
