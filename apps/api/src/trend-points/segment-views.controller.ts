import { BadRequestException, Controller, Get, Header, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import type { JwtPayload, SiteSegmentViewsQuery } from "@bms/shared";
import { siteSegmentViewsQuerySchema } from "@bms/shared";

import { idParamSchema } from "../admin/admin.schema";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SiteSegmentViewsService } from "./segment-views.service";

/**
 * `F4.302` / ADR 0108 Amendment 4 item 4 — one segment of the Trends & Energy
 * tab, one batch read per (site, segment, point, range, compare). The path id
 * is parsed first (a `ZodError`, 400 through the global filter), then the
 * query (a 400 with `flatten()` that names the query shape only, so a bad query
 * on a foreign site leaks nothing); `SiteSegmentViewsService` owns the site
 * 404, the segment and point 404s, the range 400s and the scope. The response
 * is scope-filtered, hence `no-store`. Registry key
 * `SiteSegmentViewsController_forSite`.
 */
@Controller("control-room")
@UseGuards(JwtAuthGuard)
export class SiteSegmentViewsController {
  constructor(private readonly service: SiteSegmentViewsService) {}

  @Get("sites/:locationId/segment-views")
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
   * `F4.303` (ADR 0108 Amendment 6 item 3) — the segment view's drawn series
   * as CSV, beside the read and on its query schema by identity, after the
   * read's own guards in the same order. Long format, the F4.29 guard on every
   * cell, at most `MAX_EXPORT_ROWS` rows (a 400 above, before any telemetry
   * statement). `no-store`: the answer depends on the caller's scope. The file
   * name is fixed: no id, code or name. Registry key
   * `SiteSegmentViewsController_exportCsv`.
   */
  @Get("sites/:locationId/segment-views/export.csv")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="segment-view.csv"')
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
  @Get("sites/:locationId/segment-views/export.xlsx")
  async exportXlsx(
    @Param("locationId") locationId: string,
    @Query() query: unknown,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const [id, dto] = parsedRequest(locationId, query);
    const body = await this.service.exportXlsx(user, id, dto);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="segment-view.xlsx"');
    // Scope-filtered per caller, exactly as on the CSV route.
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  }
}

/** The path id first (a `ZodError`, 400 through the global filter), then the query (a 400 with `flatten()`). */
function parsedRequest(locationId: string, query: unknown): [string, SiteSegmentViewsQuery] {
  const id = idParamSchema.parse(locationId);
  const parsed = siteSegmentViewsQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.flatten());
  }
  return [id, parsed.data];
}
