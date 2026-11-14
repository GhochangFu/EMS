import { Controller, Get, UseGuards } from "@nestjs/common";

import type { FilterOptionsResponse, JwtPayload } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FilterOptionsService } from "./filter-options.service";

/**
 * `F4.361` (ADR 0132 decision 2) — `GET /api/v1/filter-options`. Any signed-in
 * user may call it: it is a read of the caller's own scope, so there is no
 * role check and no query (and so no `REQUEST_SCHEMAS` entry).
 */
@Controller("filter-options")
@UseGuards(JwtAuthGuard)
export class FilterOptionsController {
  constructor(private readonly filterOptions: FilterOptionsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload): Promise<FilterOptionsResponse> {
    return this.filterOptions.options(user);
  }
}
