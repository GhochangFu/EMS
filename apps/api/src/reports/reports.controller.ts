import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { energyReportQuerySchema } from "./reports.schema";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly accessControl: AccessControlService,
  ) {}

  @Get("energy/preview")
  async energyPreview(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    try {
      const dto = energyReportQuerySchema.parse(query);
      return await this.reports.energyPreview(
        dto,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get("energy/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header(
    "Content-Disposition",
    'attachment; filename="energy-consumption-report.csv"',
  )
  // The export is scope-filtered per user via `readableAssetIds` and carries
  // asset codes, names and site names, so a shared-cache hit across two
  // differently-scoped users would leak data across scopes — the same
  // failure `F4.14` closed for the audit export (`audit.controller.ts`).
  @Header("Cache-Control", "no-store")
  async energyCsv(
    @CurrentUser() user: JwtPayload,
    @Query() query: unknown,
  ): Promise<string> {
    try {
      const dto = energyReportQuerySchema.parse(query);
      return await this.reports.energyCsv(
        dto,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }
}
