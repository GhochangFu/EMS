import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { calcPointBatchBodySchema } from "@bms/shared";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` (ADR 0109 decision 4, ruling 4) — one key, formula and timing on up
 * to 25 template-less assets of one organization, all or nothing. A second
 * controller class because `AssetPointCalcOverrideController` is
 * `@Controller("admin/assets")`, and this route is not about one asset.
 *
 * The write rules are `CalcPointStandaloneService`'s — the same ones the
 * single-asset `PUT` runs.
 */
@Controller("admin/calc-points")
@UseGuards(JwtAuthGuard)
export class CalcPointBatchController {
  constructor(private readonly service: CalcPointStandaloneService) {}

  /** `200`: every asset written, one item each in request order; `400` with `refused[]` otherwise. */
  @Post("batch")
  @HttpCode(HttpStatus.OK)
  async setBatch(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    try {
      return await this.service.setBatch(user, calcPointBatchBodySchema.parse(body));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
