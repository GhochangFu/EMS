import { BadRequestException, Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

import type { JwtPayload } from "@bms/shared";

import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { auditExportQuerySchema, auditListQuerySchema } from "./audit.schema";
import { AuditAdminService } from "./audit.service";
import type { AuditExportFile } from "./audit.service";

/**
 * Audit log read + export (ADR 0021, `F4.14`; widened by ADR 0046, `E7.1e`).
 *
 * The global `admin` reads every organization; an `organization_admin` reads
 * its own organizations' rows only, and never a `NULL`-organization row.
 * `location_admin` and `asset_group_admin` are refused. The gate and the scope
 * both live in `AuditAdminService.resolveReadScope` — this controller parses
 * and serialises only.
 */
@Controller("admin/audit")
@UseGuards(JwtAuthGuard)
export class AuditAdminController {
  constructor(private readonly service: AuditAdminService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    try {
      return await this.service.list(user, auditListQuerySchema.parse(query));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  @Get("export")
  async export(
    @CurrentUser() user: JwtPayload,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    let file: AuditExportFile;
    try {
      file = await this.service.export(user, auditExportQuerySchema.parse(query));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }

    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    // The most sensitive response this API produces: keep it out of browser
    // disk cache and any intermediary.
    res.setHeader("Cache-Control", "no-store");
    res.send(file.body);
  }
}
