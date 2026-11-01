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
import { energyViewQuerySchema } from "@bms/shared";
import type { EnergyFilterOptions, EnergyOrganizationViews, EnergyView, JwtPayload } from "@bms/shared";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { EnergyOrganizationViewsService } from "./energy-organization-views.service";
import { EnergyViewService } from "./energy-view.service";
import { ReportScopeService } from "./report-scope";
import { energyReportQuerySchema } from "./reports.schema";
import { ReportsService } from "./reports.service";

/**
 * The energy report routes. `F4.290` (ADR 0099 Amendment 9 E4): each takes an
 * optional `locationIds` (site ids, each with its descendants), resolved by
 * `ReportScopeService` to the caller's readable assets of those subtrees; a
 * site outside the caller's organizations is a 400, one outside the grant a
 * 403. Without it each route reads `readableAssetIds`, as before.
 */
@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly scope: ReportScopeService,
    private readonly energyViews: EnergyViewService,
    private readonly organizationViews: EnergyOrganizationViewsService,
  ) {}

  @Get("energy/preview")
  async energyPreview(@CurrentUser() user: JwtPayload, @Query() query: unknown) {
    try {
      const dto = energyReportQuerySchema.parse(query);
      return await this.reports.energyPreview(
        dto,
        await this.scope.assetIdsForCaller(user, dto.locationIds),
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
  // The export is scope-filtered per user via `assetIdsForCaller` and carries
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
        await this.scope.assetIdsForCaller(user, dto.locationIds),
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
        await this.scope.assetIdsForCaller(user, dto.locationIds),
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
    // Scope-filtered per user via `assetIdsForCaller` and carrying asset codes,
    // names and site names — a shared-cache hit across two differently-scoped
    // users would leak across scopes, exactly as on the CSV route.
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  }

  /**
   * The same report as `xlsx`, in PDF (ADR 0071 decision 2, decision 3).
   *
   * A separate route rather than a `?format=` switch on `export.csv`/`export.xlsx`,
   * for the same reason `energyXlsx` gives: the sibling routes already carry their
   * format in their path, and each response's bytes are the client deliverable.
   *
   * `@Res()` for the same reason as `energyXlsx`: the body is a `Buffer`, which
   * Nest would otherwise try to serialise as JSON.
   */
  @Get("energy/export.pdf")
  async energyPdf(
    @CurrentUser() user: JwtPayload,
    @Query() query: unknown,
    @Res() res: Response,
  ): Promise<void> {
    let body: Buffer;
    try {
      const dto = energyReportQuerySchema.parse(query);
      body = await this.reports.energyPdf(
        dto,
        await this.scope.assetIdsForCaller(user, dto.locationIds),
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="energy-consumption-report.pdf"',
    );
    // Scope-filtered per user via `assetIdsForCaller` and carrying asset codes,
    // names and site names — a shared-cache hit across two differently-scoped
    // users would leak across scopes, exactly as on the CSV and XLSX routes.
    res.setHeader("Cache-Control", "no-store");
    res.send(body);
  }

  /**
   * `F4.298` (ADR 0108 decision 2) — the Energy page's filter and KPI view: a
   * sibling of the preview, never a widened preview, so the preview and the
   * three exports stay as they are. `no-store`: the answer depends on the
   * caller's scope, the CSV route's reason.
   */
  @Get("energy/view")
  @Header("Cache-Control", "no-store")
  async energyView(@CurrentUser() user: JwtPayload, @Query() query: unknown): Promise<EnergyView> {
    try {
      const dto = energyViewQuerySchema.parse(query);
      return await this.energyViews.view(user, dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.299` (ADR 0108 Amendment 1, 7.1) — the Energy page's four organization
   * views (sites ranked, the trend by site, the heatmap, the abnormal list): a
   * sibling of `energy/view` on the same query schema, by identity, so the
   * page sends one query to both and nothing is called twice. `no-store`: the
   * answer depends on the caller's scope.
   */
  @Get("energy/organization-views")
  @Header("Cache-Control", "no-store")
  async energyOrganizationViews(
    @CurrentUser() user: JwtPayload,
    @Query() query: unknown,
  ): Promise<EnergyOrganizationViews> {
    try {
      const dto = energyViewQuerySchema.parse(query);
      return await this.organizationViews.organizationViews(user, dto);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException(err.flatten());
      }
      throw err;
    }
  }

  /**
   * `F4.298` (ADR 0108 decision 2.7) — the caller's readable organizations and
   * locations, for every role (`/admin/organizations` and `/admin/locations`
   * refuse `operator` and `viewer`). No query, so no registry entry.
   */
  @Get("energy/filter-options")
  @Header("Cache-Control", "no-store")
  async energyFilterOptions(@CurrentUser() user: JwtPayload): Promise<EnergyFilterOptions> {
    return this.energyViews.filterOptions(user);
  }
}
