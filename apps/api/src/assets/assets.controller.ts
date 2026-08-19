import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { z, ZodError } from "zod";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AssetsService } from "./assets.service";

/** Same shape as `idParamSchema` (`admin/admin.schema.ts`), kept local rather
 * than reached for across the admin/non-admin module boundary. */
const organizationIdParamSchema = z.string().uuid();

@Controller("assets")
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly accessControl: AccessControlService,
  ) {}

  /**
   * Lists seeded / configured assets for telemetry binding, and for the
   * alarm-enrichment affected-asset picker (ADR 0034 decision 4). Optional
   * `organizationId` narrows the list — found missing in review: a picker
   * built on the unscoped list mixed assets from every organization the
   * caller could see, which is confusing and not what "affected assets"
   * means for one alarm.
   */
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query("organizationId") organizationId?: string,
  ) {
    try {
      const orgId = organizationId
        ? organizationIdParamSchema.parse(organizationId)
        : undefined;
      return this.assets.listAll(await this.accessControl.readableAssetIds(user), orgId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
