import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { tariffCategoriesQuerySchema, tariffLineVersionsQuerySchema } from "@bms/shared";
import type { JwtPayload, TariffLineVersionsResponse, TariffLinesResponse } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TariffLinesService } from "./tariff-lines.service";

/**
 * `F4.365` U5 (ADR 0134, plan D6) — the tariff read routes, any signed-in
 * user. A `ZodError` from a parse is the global filter's 400 (ADR 0060).
 *
 * The versions route takes the line as `?key=` (ADR 0134 Amendment 1): 104 of
 * 316 keys contain `/`, which a path segment cannot carry. No `:param` route
 * exists in this controller; were one added, it must be declared after these.
 */
@Controller("tariffs")
@UseGuards(JwtAuthGuard)
export class TariffsController {
  constructor(private readonly lines: TariffLinesService) {}

  @Get("categories")
  async categories(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<TariffLinesResponse> {
    return this.lines.listCategories(user, tariffCategoriesQuerySchema.parse(query));
  }

  @Get("lines/versions")
  async versions(@Query() query: unknown, @CurrentUser() user: JwtPayload): Promise<TariffLineVersionsResponse> {
    return this.lines.listVersions(user, tariffLineVersionsQuerySchema.parse(query));
  }
}
