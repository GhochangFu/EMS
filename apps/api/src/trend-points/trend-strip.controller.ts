import { BadRequestException, Controller, Get, Header, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import type { JwtPayload, SiteTrendStripQuery } from "@bms/shared";
import { siteTrendStripQuerySchema } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SiteTrendStripService } from "./trend-strip.service";

/**
 * `F4.301` / ADR 0108 Amendment 2 item 3 — the Control Room trend strip, one
 * batch read per (tab, range). The path id is parsed first (a `ZodError`, 400
 * through the global filter), then the query (a 400 with `flatten()` that
 * names the query shape only, so a bad query on a foreign site leaks nothing);
 * `SiteTrendStripService` owns the site 404, the group 404 and the scope. The
 * response is scope-filtered, hence `no-store`.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteTrendStripController {
  constructor(private readonly service: SiteTrendStripService) {}

  @Get("sites/:locationId/trend-strip")
  @Header("Cache-Control", "no-store")
  async forSite(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ) {
    const [id, dto] = parsedRequest(locationId, query);
    return this.service.forSite(user, id, dto);
  }

  /**
   * `F4.303` (ADR 0108 Amendment 6 item 3) — the strip's series as CSV, beside
   * the read and on its query schema by identity, after the read's own guards
   * in the same order. Long format, the F4.29 guard on every cell, at most
   * `MAX_EXPORT_ROWS` rows (a 400 above, before the telemetry statement).
   * `no-store`: the answer depends on the caller's scope. The file name is
   * fixed: no id, code or name. Registry key `SiteTrendStripController_exportCsv`.
   */
  @Get("sites/:locationId/trend-strip/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="trend-strip.csv"')
  @Header("Cache-Control", "no-store")
  async exportCsv(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
  ): Promise<string> {
    const [id, dto] = parsedRequest(locationId, query);
    return this.service.exportCsv(user, id, dto);
  }

  /** `F4.303` — the same rows as `xlsx`, one sheet. `@Res()`: the body is a `Buffer`. */
  @Get("sites/:locationId/trend-strip/export.xlsx")
  async exportXlsx(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const [id, dto] = parsedRequest(locationId, query);
    const body = await this.service.exportXlsx(user, id, dto);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="trend-strip.xlsx"');
    // Scope-filtered per caller, exactly as on the CSV route.
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  }
}

/** The path id first (a `ZodError`, 400 through the global filter), then the query (a 400 with `flatten()`). */
function parsedRequest(locationId: string, query: unknown): [string, SiteTrendStripQuery] {
  const id = idParamSchema.parse(locationId);
  const parsed = siteTrendStripQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return [id, parsed.data];
}
