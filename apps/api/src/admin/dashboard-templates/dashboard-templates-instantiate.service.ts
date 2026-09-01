import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import {
  assetGroupMembers,
  assetGroups,
  assetPoints,
  assets,
  dashboards,
  dashboardWidgetPoints,
  dashboardWidgets,
  dashboardWidgetSources,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  dashboardDtoSchema,
  sectionTemplateContentSchema,
  WIDGET_POINT_CARDINALITY,
} from "@bms/shared";
import type {
  InstantiateSectionTemplateResponse,
  JwtPayload,
  SectionTemplateWidget,
  TemplateWidgetResolutionDto,
  TemplateWidgetResolutionOutcome,
} from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { MasterDataAuditService } from "../master-data-audit.service";
import type { InstantiateSectionTemplateBody } from "./dashboard-templates.schema";
import { DashboardTemplatesService } from "./dashboard-templates.service";

/**
 * Instantiating a section template against one asset group — `F3.36` Part E4,
 * ADR 0049 decision 4 and 6, and **Amendment 2**.
 *
 * A template widget names *"the incoming-supply meter's `kW`"*. This resolves
 * that against the target group's members and binds each matching member's
 * point.
 *
 * ---
 *
 * **AMENDMENT 2 DECISION 1 IS WHAT THIS FILE IS FOR: INSTANTIATION NEVER
 * SUCCEEDS SILENTLY.**
 *
 * Every widget comes back with the roles it named, how many members matched, how
 * many points were bound, and a single `outcome`. A future reader may disagree
 * with the tie-break below and change it; **the report is not theirs to drop.**
 * `F3.37` shipped `roleCounts` one level down for exactly this reason, and its
 * closure records the case in one sentence: *"two-of-three renders a widget that
 * looks right and is one short."*
 *
 * The four outcomes, and where each was ruled:
 *
 * | Case | Outcome | Ruled by |
 * |---|---|---|
 * | every matching member bound | `bound` | migration `0051`'s header |
 * | more members than the widget holds | `truncated` | Amendment 2 decision 2 |
 * | members matched, some carry no such point | `partial` | Amendment 2 decision 3 |
 * | the role matched nothing | `unresolved` | ADR 0049 decision 6 |
 *
 * **An unresolved role is never a failed import** (decision 6). Refusing would
 * give a plant with five of six sections nothing at all, and `F3.1c` already
 * renders a widget with zero bindings as "no data bound" — a state the schema
 * can report and a person can fix.
 *
 * **The tie-break is the FIRST MEMBER BY `assets.code`** (Amendment 2 decision
 * 2). `assets.code` is `NOT NULL UNIQUE`, so it is a total order and the answer
 * is deterministic rather than whatever the planner happened to return.
 * `F3.37`'s `members()` established that order; this reuses it rather than
 * inventing a second.
 *
 * ---
 *
 * **THE WHOLE INSTANTIATION IS ONE TRANSACTION.** A refused write must leave no
 * half-built dashboard behind — a dashboard row with no widgets is worse than no
 * dashboard, because it looks like a template that produces nothing.
 */

interface ResolvedMemberPoint {
  readonly pointId: string;
  readonly assetCode: string;
}

@Injectable()
export class DashboardTemplatesInstantiateService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly audit: MasterDataAuditService,
    private readonly templates: DashboardTemplatesService,
  ) {}

  async instantiate(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateSectionTemplateBody,
  ): Promise<InstantiateSectionTemplateResponse> {
    const template = await this.templates.fetchRow(templateId);
    await this.templates.assertCanAuthor(jwt, template.organizationId);

    // Only a published version instantiates. A draft is still being authored,
    // and an archived one is retired — instantiating either would pin a
    // dashboard to a version nobody intends to support.
    if (template.status !== "published") {
      throw new ConflictException(
        `Only a published template can be instantiated; this one is ${template.status}`,
      );
    }

    const [group] = await this.fleetDb
      .select({ id: assetGroups.id, organizationId: assetGroups.organizationId })
      .from(assetGroups)
      .where(eq(assetGroups.id, body.assetGroupId))
      .limit(1);
    if (!group) {
      throw new NotFoundException("Asset group not found");
    }
    // The group must belong to the template's organization. Checked here rather
    // than left to the policy, so the caller gets a 403 naming the scope instead
    // of a row-level-security error naming a policy.
    if (group.organizationId !== template.organizationId) {
      throw new ForbiddenException("Asset group is outside your access scope");
    }

    const content = sectionTemplateContentSchema.parse(template.content);
    if (content.widgets.length === 0) {
      throw new BadRequestException("This template has no widgets to instantiate");
    }

    const members = await this.loadMembersByRole(body.assetGroupId);
    const pointsByAsset = await this.loadActivePoints(template.organizationId);

    const plans = content.widgets.map((widget) =>
      this.planWidget(widget, members, pointsByAsset),
    );

    const created = await withTenant(this.tenantDb, template.organizationId, async (tx) => {
      const [dashboardRow] = await tx
        .insert(dashboards)
        .values({
          organizationId: template.organizationId,
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          assetGroupId: body.assetGroupId,
          // ADR 0049 decision 2 — the version stamp. Revising the template
          // later must not disturb this dashboard, and without the stamp
          // nobody could tell which dashboards are on which version.
          templateId: template.id,
        })
        .returning();
      if (!dashboardRow) {
        throw new ConflictException("A dashboard with this slug already exists");
      }

      for (const plan of plans) {
        const [widgetRow] = await tx
          .insert(dashboardWidgets)
          .values({
            organizationId: template.organizationId,
            dashboardId: dashboardRow.id,
            widgetType: plan.widget.widgetType,
            title: plan.widget.title,
            gridX: plan.widget.gridX,
            gridY: plan.widget.gridY,
            gridW: plan.widget.gridW,
            gridH: plan.widget.gridH,
            config: plan.widget.config,
          })
          .returning();
        if (!widgetRow) {
          throw new ConflictException("Widget could not be created");
        }

        if (plan.points.length > 0) {
          await tx.insert(dashboardWidgetPoints).values(
            plan.points.map((point, index) => ({
              organizationId: template.organizationId,
              widgetId: widgetRow.id,
              pointId: point.pointId,
              role: plan.pointRole,
              sortOrder: index,
            })),
          );
        }

        if (plan.widget.sources.length > 0) {
          await tx.insert(dashboardWidgetSources).values(
            plan.widget.sources.map((source, index) => ({
              organizationId: template.organizationId,
              widgetId: widgetRow.id,
              catalogKey: source.catalogKey,
              params: source.params,
              sortOrder: source.sortOrder ?? index,
            })),
          );
        }
      }

      await this.audit.write(
        {
          actor: jwt,
          organizationId: template.organizationId,
          action: "instantiate",
          entityType: "dashboard",
          entityId: dashboardRow.id,
          reason: `from template ${template.code} v${template.version}`,
        },
        tx,
      );

      return dashboardRow;
    });

    const dashboard = await this.readBack(created.id, template.organizationId);
    return {
      dashboard,
      resolutions: plans.map((plan) => plan.resolution),
    };
  }

  /**
   * Members of one group, grouped by role and **ordered by `assets.code`**.
   *
   * The order is the whole reason "the first match" is an answer rather than a
   * coin toss: `assets.code` is `NOT NULL UNIQUE`, so it is a total order.
   * Members with no role are skipped — a membership with a NULL role plays no
   * named part and no template widget can name it.
   */
  private async loadMembersByRole(assetGroupId: string): Promise<Map<string, string[]>> {
    const rows = await this.fleetDb
      .select({ role: assetGroupMembers.role, assetId: assets.id, code: assets.code })
      .from(assetGroupMembers)
      .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
      .where(eq(assetGroupMembers.assetGroupId, assetGroupId))
      .orderBy(asc(assets.code));

    const byRole = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.role) continue;
      const list = byRole.get(row.role) ?? [];
      list.push(row.assetId);
      byRole.set(row.role, list);
    }
    return byRole;
  }

  /** Active points, keyed `assetId::pointKey`. Inactive points are skipped:
   * binding a retired sensor is the shortfall `partial` exists to report. */
  private async loadActivePoints(organizationId: string): Promise<Map<string, string>> {
    const rows = await this.fleetDb
      .select({ id: assetPoints.id, assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
      .from(assetPoints)
      .where(and(eq(assetPoints.organizationId, organizationId), eq(assetPoints.active, true)));

    const byKey = new Map<string, string>();
    for (const row of rows) {
      byKey.set(`${row.assetId}::${row.pointKey}`, row.id);
    }
    return byKey;
  }

  /**
   * Resolve one widget's bindings, and say what became of them.
   *
   * **The outcome is decided by two counts, not by a chain of special cases.**
   * `matchedMembers` is how many members the widget's roles matched;
   * `boundPoints` is how many points were actually bound. Everything else falls
   * out of comparing them against the type's cap, which is what keeps the four
   * outcomes from drifting apart as the widget catalog grows.
   */
  private planWidget(
    widget: SectionTemplateWidget,
    membersByRole: Map<string, string[]>,
    pointsByAsset: Map<string, string>,
  ): {
    widget: SectionTemplateWidget;
    points: ResolvedMemberPoint[];
    pointRole: string;
    resolution: TemplateWidgetResolutionDto;
  } {
    const cap = WIDGET_POINT_CARDINALITY[widget.widgetType].max;
    const assetRoleCodes = widget.bindings.map((binding) => binding.assetRoleCode);

    let matchedMembers = 0;
    const resolved: ResolvedMemberPoint[] = [];

    for (const binding of widget.bindings) {
      const memberIds = membersByRole.get(binding.assetRoleCode) ?? [];
      matchedMembers += memberIds.length;
      for (const assetId of memberIds) {
        const pointId = pointsByAsset.get(`${assetId}::${binding.pointKey}`);
        if (pointId) {
          resolved.push({ pointId, assetCode: assetId });
        }
      }
    }

    // The cap bites AFTER resolution, so `truncated` is reported against what
    // actually matched rather than against the authored binding count.
    const points = resolved.slice(0, cap);

    return {
      widget,
      points,
      pointRole: widget.bindings[0]?.pointRole ?? "primary",
      resolution: {
        widgetKey: widget.key,
        assetRoleCodes,
        matchedMembers,
        boundPoints: points.length,
        outcome: this.outcomeOf(assetRoleCodes.length, matchedMembers, resolved.length, points.length),
      },
    };
  }

  /**
   * The four outcomes of Amendment 2, in the order they are decided.
   *
   * A widget with no role bindings at all — a metric-catalog tile, which four of
   * Sheet 02's five Electrical KPI tiles are — is `bound`, not `unresolved`. It
   * asked for no role and got none, which is success; reporting it as a
   * shortfall would put an amber flag beside every correctly-bound tile and
   * teach the reader to ignore the report.
   */
  private outcomeOf(
    roleCount: number,
    matchedMembers: number,
    resolvedPoints: number,
    boundPoints: number,
  ): TemplateWidgetResolutionOutcome {
    if (roleCount === 0) return "bound";
    if (matchedMembers === 0) return "unresolved";
    if (boundPoints < resolvedPoints) return "truncated";
    if (resolvedPoints < matchedMembers) return "partial";
    return "bound";
  }

  /** The created dashboard with its widgets, read back so the response carries
   * real ids rather than what the caller sent. */
  private async readBack(
    dashboardId: string,
    organizationId: string,
  ): Promise<InstantiateSectionTemplateResponse["dashboard"]> {
    const [row] = await this.fleetDb
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.id, dashboardId), eq(dashboards.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Dashboard not found after instantiation");
    }

    const widgetRows = await this.fleetDb
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.dashboardId, dashboardId))
      .orderBy(asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));

    const widgets = [];
    for (const widget of widgetRows) {
      const points = await this.fleetDb
        .select({
          id: dashboardWidgetPoints.id,
          pointId: dashboardWidgetPoints.pointId,
          role: dashboardWidgetPoints.role,
          sortOrder: dashboardWidgetPoints.sortOrder,
          assetId: assetPoints.assetId,
          pointKey: assetPoints.pointKey,
          unit: assetPoints.unit,
        })
        .from(dashboardWidgetPoints)
        .innerJoin(assetPoints, eq(dashboardWidgetPoints.pointId, assetPoints.id))
        .where(eq(dashboardWidgetPoints.widgetId, widget.id))
        .orderBy(asc(dashboardWidgetPoints.sortOrder));

      const sources = await this.fleetDb
        .select({
          id: dashboardWidgetSources.id,
          catalogKey: dashboardWidgetSources.catalogKey,
          params: dashboardWidgetSources.params,
          sortOrder: dashboardWidgetSources.sortOrder,
        })
        .from(dashboardWidgetSources)
        .where(eq(dashboardWidgetSources.widgetId, widget.id))
        .orderBy(asc(dashboardWidgetSources.sortOrder));

      widgets.push({
        id: widget.id,
        dashboardId: widget.dashboardId,
        organizationId: widget.organizationId,
        title: widget.title,
        gridX: widget.gridX,
        gridY: widget.gridY,
        gridW: widget.gridW,
        gridH: widget.gridH,
        points: points.map((point) => ({
          id: point.id,
          pointId: point.pointId,
          role: point.role,
          sortOrder: point.sortOrder,
          assetId: point.assetId,
          pointKey: point.pointKey,
          unit: point.unit,
        })),
        sources,
        widgetType: widget.widgetType,
        config: widget.config,
      });
    }

    return dashboardDtoSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      locationId: row.locationId,
      assetGroupId: row.assetGroupId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      widgets,
    });
  }
}
