import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";

import { assetTemplates, templatePoints } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { FLEET_DRIZZLE } from "../../database/database.tokens";
import { dashboardWidgetRowsFor } from "../asset-templates/asset-dashboards-plan";
import { parseStoredTemplateContent } from "../asset-templates/asset-templates-content.schema";
import { AssetTemplatesStockService } from "../asset-templates/asset-templates-stock.service";
import type { StockTemplateRef, TemplatePointRef, TemplateRef, ValidateTemplateContext } from "./onboarding-template-refs";

/** The alarm and dashboard-widget counts of one stored `content`; an unparsable one counts 0 (the core refuses it at commit). */
function contentCounts(content: unknown): { alarmCount: number; dashboardWidgetCount: number } {
  const parsed = parseStoredTemplateContent(content);
  if (!parsed.ok) {
    return { alarmCount: 0, dashboardWidgetCount: 0 };
  }
  return {
    alarmCount: (parsed.content.alarms ?? []).length,
    dashboardWidgetCount: dashboardWidgetRowsFor(parsed.content.dashboards ?? {}),
  };
}

function pointKind(kind: string): TemplatePointRef["kind"] {
  return kind === "derived" ? "derived" : "measured";
}

function templateStatus(status: string): NonNullable<TemplateRef["status"]> {
  return status === "published" || status === "archived" ? status : "draft";
}

/**
 * `F3.22` (ADR 0091 decisions 3 and 6) — the templates an onboarding draft
 * may name: the organization's own versions and the shipped stock catalog.
 *
 * **`fleetDb`, not `AssetTemplatesAdminService.list/getById`.** The tool
 * context carries no `jwt`, and the organization is authorized upstream
 * (`OnboardingService.loadSession`) — the argument `OnboardingCatalogService`
 * records for `point_keys`. `asset_templates` and `template_points` are
 * `FORCE` tenant tables and `fleetDb` is `BYPASSRLS`, so both reads filter by
 * `organizationId` themselves; the `template_points` read filters by it as
 * well as by the template ids, so it cannot reach another tenant's points
 * even through a wrong id. Two reads, where a per-template `getById` would be
 * one per template.
 */
@Injectable()
export class OnboardingTemplateCatalogService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly db: BmsDb,
    private readonly stock: AssetTemplatesStockService,
  ) {}

  private stockRefs: readonly StockTemplateRef[] | undefined;

  /**
   * Every version the organization holds, in every status (V10 refuses a code
   * held "in any version"). Only a **published** version carries its points:
   * nothing builds an asset from a draft or an archived one.
   */
  async listOrganizationTemplates(organizationId: string): Promise<TemplateRef[]> {
    const rows = await this.db
      .select({
        id: assetTemplates.id,
        code: assetTemplates.code,
        version: assetTemplates.version,
        name: assetTemplates.name,
        domain: assetTemplates.domain,
        status: assetTemplates.status,
        content: assetTemplates.content,
      })
      .from(assetTemplates)
      .where(eq(assetTemplates.organizationId, organizationId))
      .orderBy(asc(assetTemplates.code), asc(assetTemplates.version));

    const publishedIds = rows.filter((row) => row.status === "published").map((row) => row.id);
    const pointRows =
      publishedIds.length === 0
        ? []
        : await this.db
            .select({
              templateId: templatePoints.templateId,
              pointKey: templatePoints.pointKey,
              kind: templatePoints.kind,
              required: templatePoints.required,
              sourceDataKeyPattern: templatePoints.sourceDataKeyPattern,
            })
            .from(templatePoints)
            .where(
              and(eq(templatePoints.organizationId, organizationId), inArray(templatePoints.templateId, publishedIds)),
            )
            .orderBy(asc(templatePoints.sortOrder), asc(templatePoints.pointKey));

    const pointsById = new Map<string, TemplatePointRef[]>();
    for (const point of pointRows) {
      const list = pointsById.get(point.templateId) ?? [];
      list.push({
        pointKey: point.pointKey,
        kind: pointKind(point.kind),
        required: point.required,
        sourceDataKeyPattern: point.sourceDataKeyPattern,
      });
      pointsById.set(point.templateId, list);
    }

    return rows.map((row) => {
      const status = templateStatus(row.status);
      return {
        code: row.code,
        version: row.version,
        name: row.name,
        domain: row.domain,
        status,
        points: status === "published" ? (pointsById.get(row.id) ?? []) : [],
        ...(status === "published" ? contentCounts(row.content) : { alarmCount: 0, dashboardWidgetCount: 0 }),
      };
    });
  }

  /**
   * The shipped catalog as refs: no version, no status, `stockVersion` beside
   * them. Reads no database. Projected once and kept: the catalog is code and
   * arrives frozen through its DI token, so every turn would otherwise re-parse
   * the same entries.
   */
  listStock(): readonly StockTemplateRef[] {
    this.stockRefs ??= this.stock.list().items.map((entry) => ({
      code: entry.code,
      version: null,
      name: entry.name,
      domain: entry.domain,
      status: null,
      stockVersion: entry.stockVersion,
      points: entry.points.map((point) => ({
        pointKey: point.pointKey,
        kind: pointKind(point.kind),
        required: point.required,
        sourceDataKeyPattern: point.sourceDataKeyPattern,
      })),
      ...contentCounts(entry.content),
    }));
    return this.stockRefs;
  }

  /**
   * The context a validation reads, once per request. With no organization
   * (the guided chat with none bound) only the stock is listed.
   */
  async context(organizationId: string | undefined): Promise<ValidateTemplateContext> {
    return {
      organization: organizationId === undefined ? [] : await this.listOrganizationTemplates(organizationId),
      stock: this.listStock(),
    };
  }
}
