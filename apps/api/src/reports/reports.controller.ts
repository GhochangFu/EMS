import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
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

  /**
   * The same report as `xlsx` (ADR 0026 Amendment 2, `F4.51`).
   *
   * A separate route rather than a `?format=` switch on `export.csv`, because the
   * sibling route already carries its format in its path and because the CSV
   * response must stay byte-identical — its bytes are the client deliverable ADR
   * 0026 exists to protect.
   *
   * `@Res()` for the same reason `audit.controller.ts` uses it: the body is a
   * `Buffer`, which Nest would otherwise try to serialise as JSON.
   */
  @Get("energy/export.xlsx")
  async energyXlsx(
    @CurrentUser() user: JwtPayload,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    let body: Buffer;
    try {
      const dto = energyReportQuerySchema.parse(query);
      body = await this.reports.energyXlsx(
        dto,
        await this.accessControl.readableAssetIds(user),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="energy-consumption-report.xlsx"',
    );
    // Scope-filtered per user via `readableAssetIds` and carrying asset codes,
    // names and site names — a shared-cache hit across two differently-scoped
    // users would leak across scopes, exactly as on the CSV route.
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  }
}
