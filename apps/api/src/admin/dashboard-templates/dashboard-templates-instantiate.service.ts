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

import { AccessControlService } from "../../auth/access-control.service";
// `F4.108` / ADR 0060 ruling 2 — both parses below read stored data: a
// template's `content` column, and the dashboard this service has just written
// and read back. Neither can be the caller's fault, so neither may become a 400.
import { parseStoredContract } from "../../common/parse-stored-contract";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { resolveBoundPoints } from "../../dashboard-builder/dashboard-point-scope";
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
 *
 * ---
 *
 * **`E4.2` / ADR 0072 DECISION 1 GAVE THIS METHOD A SECOND ARM.** A template
 * whose every widget has zero `bindings` may instantiate with
 * `assetGroupId: null`, and lands organization-wide: both scope columns `NULL`,
 * no member resolution, `sources` copied verbatim as before. Everything above
 * still describes the asset-group arm, which is unchanged — the second arm has
 * no role to resolve, so it has no report to get wrong.
 */

interface ResolvedMemberPoint {
  readonly pointId: string;
  /** The asset's `code`, which is what Amendment 2 decision 2's tie-break sorts
   * on. It held a uuid until the `F3.36` correctness review; see
   * `loadMembersByRole`. */
  readonly assetCode: string;
}

/** One member of the target group, carrying the column the tie-break needs. */
interface GroupMember {
  readonly assetId: string;
  readonly code: string;
}

@Injectable()
export class DashboardTemplatesInstantiateService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly templates: DashboardTemplatesService,
  ) {}

  async instantiate(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateSectionTemplateBody,
  ): Promise<InstantiateSectionTemplateResponse> {
    const template = await this.templates.fetchRow(templateId);
    // READABILITY, not authorship — ADR 0015 Amendment 1B, restated in
    // `AccessControlService.canManageTemplate`'s own docblock: *"This method is
    // not consulted by instantiation, and must not be … Instantiation instead
    // requires template readability plus a check on the TARGET."* A location
    // admin deploys a published organization template into their own scope
    // without being able to author one. That is model-once-deploy-many.
    await this.templates.assertCanRead(jwt, template.organizationId);

    // Only a published version instantiates. A draft is still being authored,
    // and an archived one is retired — instantiating either would pin a
    // dashboard to a version nobody intends to support.
    if (template.status !== "published") {
      throw new ConflictException(
        `Only a published template can be instantiated; this one is ${template.status}`,
      );
    }

    /**
     * **The organization-wide arm — `E4.2`, ADR 0072 decision 1.**
     *
     * There is no group to look up, no organization match to make and no member
     * to resolve. The one authorization question left is the one
     * `DashboardsService.create` asks of the same row: may this caller create a
     * dashboard with no scope column at all? `canManageDashboard` answers it
     * with ADR 0047 Amendment 2 ruling 2 — an ownerless, tenant-wide row is the
     * two organization-level roles' to make and nobody else's. Without this call
     * the template door would let a `location_admin` create exactly the row
     * `/dashboards` refuses them, which is the asymmetry the `F3.36` security
     * review found on the group arm.
     *
     * The binding refusal is NOT here: it needs the parsed `content`, so it sits
     * immediately after the parse below. Authorization first means a caller who
     * may not write here never learns whether the template binds a role.
     */
    if (body.assetGroupId === null) {
      if (
        !(await this.accessControl.canManageDashboard(jwt, template.organizationId, {
          locationId: null,
          assetGroupId: null,
          assetId: null,
        }))
      ) {
        throw new ForbiddenException(
          "Only an organization admin can create an organization-wide dashboard",
        );
      }
    } else {
      await this.assertGroupTargetIsWritable(jwt, template.organizationId, body.assetGroupId);
    }

    const content = parseStoredContract(
      sectionTemplateContentSchema,
      template.content,
      "dashboard_templates_instantiate.instantiate.content",
    );
    if (content.widgets.length === 0) {
      throw new BadRequestException("This template has no widgets to instantiate");
    }

    /**
     * **A template that binds a role still needs a group — ADR 0072 decision 1.**
     *
     * A binding names an asset-group ROLE (ADR 0049 decision 4) and resolves
     * against the target group's members. With no group every binding would
     * match nothing, so the whole canvas would land `unresolved`: a dashboard
     * that looks imported and shows nothing. Amendment 2 decision 1's rule is
     * that instantiation never succeeds silently, and this is the one case where
     * the honest answer is a refusal rather than a report.
     *
     * Read from the PINNED version's stored `content`, which is the same content
     * the widgets below are planned from — so the guard cannot disagree with
     * what is about to be written.
     */
    if (body.assetGroupId === null && content.widgets.some((w) => w.bindings.length > 0)) {
      throw new BadRequestException("A template with role bindings needs an asset group");
    }

    // Both maps are empty on the organization-wide arm: there is no group to
    // read members from, and with no bindings there is no point to look up.
    // `planWidget` still runs for every widget — Amendment 2 decision 1 wants a
    // resolution entry per widget, and a zero-binding widget is already `bound`.
    const members =
      body.assetGroupId === null
        ? new Map<string, GroupMember[]>()
        : await this.loadMembersByRole(body.assetGroupId, template.organizationId);
    const pointsByAsset =
      body.assetGroupId === null
        ? new Map<string, string>()
        : await this.loadActivePoints(template.organizationId);

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
          action: "master.dashboard.instantiate",
          entityType: "dashboard",
          entityId: dashboardRow.id,
          reason: `from template ${template.code} v${template.version}`,
        },
        tx,
      );

      return dashboardRow;
    }).catch((err) => {
      // Drizzle THROWS on a 23505, so the `if (!dashboardRow)` guard above is
      // unreachable and a repeated slug reached the client as a 500 carrying a
      // constraint name. `DashboardsService.translateSlugConflict` is the
      // precedent this copies. Found by the `F3.36` correctness review.
      const constraint = (err as { constraint?: string } | null)?.constraint;
      if (constraint === "dashboards_organization_slug_key") {
        throw new ConflictException(
          `A dashboard with slug "${body.slug}" already exists in this organization. Choose a different slug.`,
        );
      }
      throw err;
    });

    const dashboard = await this.readBack(created.id, template.organizationId);
    return {
      dashboard,
      resolutions: plans.map((plan) => plan.resolution),
    };
  }

  /**
   * The asset-group arm's two target checks, lifted out of `instantiate` when
   * `E4.2` gave that method a second arm. **Byte-for-byte the same checks in the
   * same order**, including both comments — a refactor that reordered them would
   * be a security change, not a tidy-up.
   *
   * **The organization match is not authorization.** It only proves the group
   * and the template belong to the same tenant. Without the second check a
   * `location_admin` at one site could instantiate into an asset group at any
   * other site of the same organization — and the asymmetry proved it was wrong
   * rather than merely untidy: `canManageDashboard` refuses that exact row, so
   * the caller created a dashboard they could not then edit or delete through
   * `/dashboards`. This is the predicate `DashboardsService.create` already
   * applies to the same write, so the two doors into `bms.dashboards` agree.
   * Found by the `F3.36` security review.
   */
  private async assertGroupTargetIsWritable(
    jwt: JwtPayload,
    organizationId: string,
    assetGroupId: string,
  ): Promise<void> {
    const [group] = await this.fleetDb
      .select({ id: assetGroups.id, organizationId: assetGroups.organizationId })
      .from(assetGroups)
      .where(eq(assetGroups.id, assetGroupId))
      .limit(1);
    if (!group) {
      throw new NotFoundException("Asset group not found");
    }
    // The group must belong to the template's organization. Checked here rather
    // than left to the policy, so the caller gets a 403 naming the scope instead
    // of a row-level-security error naming a policy.
    if (group.organizationId !== organizationId) {
      throw new ForbiddenException("Asset group is outside your access scope");
    }

    if (
      !(await this.accessControl.canManageDashboard(jwt, organizationId, {
        locationId: null,
        assetGroupId,
        // `F3.2` — a section template instantiates into an ASSET GROUP, never an asset
        // (ADR 0067 decision 1 gives the asset axis its own writer). Explicitly null rather
        // than omitted: the field is required on the scope, so a later asset-scoped caller
        // here has to state its intent instead of inheriting a default.
        assetId: null,
      }))
    ) {
      throw new ForbiddenException("Asset group is outside your access scope");
    }
  }

  /**
   * Members of one group, grouped by role and **ordered by `assets.code`**.
   *
   * The order is the whole reason "the first match" is an answer rather than a
   * coin toss: `assets.code` is `NOT NULL UNIQUE`, so it is a total order.
   * Members with no role are skipped — a membership with a NULL role plays no
   * named part and no template widget can name it.
   */
  private async loadMembersByRole(
    assetGroupId: string,
    organizationId: string,
  ): Promise<Map<string, GroupMember[]>> {
    const rows = await this.fleetDb
      .select({ role: assetGroupMembers.role, assetId: assets.id, code: assets.code })
      .from(assetGroupMembers)
      .innerJoin(assets, eq(assetGroupMembers.assetId, assets.id))
      // `bms_fleet` holds `BYPASSRLS`, so this predicate is the ONLY isolation
      // control on this read — `dashboard-point-scope.ts` states the rule and
      // calls a foreign `assetId` leaving the module "a cross-tenant telemetry
      // read waiting to happen". The organization filter was missing: a foreign
      // member yielded no binding only because `loadActivePoints` filters, which
      // makes containment transitive on a predicate one file away. Added by the
      // `F3.36` security review.
      .where(
        and(
          eq(assetGroupMembers.assetGroupId, assetGroupId),
          eq(assets.organizationId, organizationId),
        ),
      )
      .orderBy(asc(assets.code));

    const byRole = new Map<string, GroupMember[]>();
    for (const row of rows) {
      if (!row.role) continue;
      const list = byRole.get(row.role) ?? [];
      // The CODE is carried, not only the id. It used to be selected and then
      // discarded, and the field that survived was named `assetCode` while
      // holding a uuid — so the next reader who sorted on it would have sorted
      // by uuid and silently lost Amendment 2 decision 2's tie-break. Found by
      // the `F3.36` correctness review.
      list.push({ assetId: row.assetId, code: row.code });
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
   * **PER BINDING, then combined — and that is a correction.** The first version
   * summed across bindings and decided the outcome from the sums, which reported
   * a widget as `bound` when one of its roles matched nothing at all: a chart
   * binding `chiller/kVA` (three members, all resolving) and `cooling-tower/kW`
   * (no such member) summed to `matched 3, bound 3` and read as complete. That
   * is precisely the silent success Amendment 2 decision 1 exists to prevent,
   * and the widget then never appeared in the list decision 6 calls *"a page
   * that can list exactly which ones need it"*. Found by the `F3.36` correctness
   * review.
   *
   * Two further defects had the same root and are fixed here:
   *
   * - **`matchedMembers` double-counted.** Two bindings naming one role over
   *   three members reported six. The DTO says *"how many asset-group members
   *   the widget's roles matched"*, so it is the size of the UNION.
   * - **The tie-break was per binding.** Ordering was binding index first and
   *   `assets.code` second, so a `max = 1` widget naming two roles bound the
   *   first *binding's* first member. Amendment 2 decision 2 says the first
   *   member by `assets.code`, full stop — so the candidates are sorted
   *   globally before the cap is applied.
   */
  private planWidget(
    widget: SectionTemplateWidget,
    membersByRole: Map<string, GroupMember[]>,
    pointsByAsset: Map<string, string>,
  ): {
    widget: SectionTemplateWidget;
    points: ResolvedMemberPoint[];
    pointRole: string;
    resolution: TemplateWidgetResolutionDto;
  } {
    const cap = WIDGET_POINT_CARDINALITY[widget.widgetType].max;
    const assetRoleCodes = widget.bindings.map((binding) => binding.assetRoleCode);

    const matchedAssetIds = new Set<string>();
    const candidates: ResolvedMemberPoint[] = [];
    const seenPointIds = new Set<string>();
    /** Did EVERY binding resolve every member it matched? */
    let everyBindingWhole = true;

    for (const binding of widget.bindings) {
      const members = membersByRole.get(binding.assetRoleCode) ?? [];
      let resolvedForThisBinding = 0;

      for (const member of members) {
        matchedAssetIds.add(member.assetId);
        const pointId = pointsByAsset.get(`${member.assetId}::${binding.pointKey}`);
        if (!pointId) continue;
        resolvedForThisBinding += 1;
        // Two bindings can name the same (role, pointKey) pair, which would
        // insert one point twice and violate
        // `dashboard_widget_points_widget_point_role_key` — a 500 carrying a
        // constraint name. The contract refuses the duplicate at authoring
        // time; this makes the resolver idempotent regardless.
        if (seenPointIds.has(pointId)) continue;
        seenPointIds.add(pointId);
        candidates.push({ pointId, assetCode: member.code });
      }

      // A binding that matched members but resolved fewer points is short; a
      // binding that matched nothing at all is short by everything.
      if (resolvedForThisBinding < members.length || members.length === 0) {
        everyBindingWhole = false;
      }
    }

    // Amendment 2 decision 2's tie-break, applied to the whole candidate set
    // rather than within a binding. `assets.code` is NOT NULL UNIQUE, so this
    // is a total order and "the first" is a deterministic answer.
    candidates.sort((a, b) => a.assetCode.localeCompare(b.assetCode));
    const points = candidates.slice(0, cap);

    return {
      widget,
      points,
      pointRole: widget.bindings[0]?.pointRole ?? "primary",
      resolution: {
        widgetKey: widget.key,
        assetRoleCodes,
        matchedMembers: matchedAssetIds.size,
        boundPoints: points.length,
        outcome: this.outcomeOf({
          roleCount: assetRoleCodes.length,
          matchedMembers: matchedAssetIds.size,
          candidates: candidates.length,
          boundPoints: points.length,
          everyBindingWhole,
        }),
      },
    };
  }

  /**
   * The four outcomes of Amendment 2, in the order they are decided.
   *
   * A widget with no role bindings at all — a metric-catalog tile, which four of
   * Sheet 04's five Electrical KPI tiles are — is `bound`, not `unresolved`. It
   * asked for no role and got none, which is success; reporting it as a
   * shortfall would put an amber flag beside every correctly-bound tile and
   * teach the reader to ignore the report.
   */
  private outcomeOf(counts: {
    roleCount: number;
    matchedMembers: number;
    candidates: number;
    boundPoints: number;
    /** False when ANY binding matched no members, or matched more members than
     * it could resolve points for. This is the input the summed version did not
     * have, and its absence is what let a widget with one dead role report
     * `bound`. */
    everyBindingWhole: boolean;
  }): TemplateWidgetResolutionOutcome {
    // Asked for no role, got none. Success, and flagging it would put an amber
    // marker beside every correctly-bound metric tile.
    if (counts.roleCount === 0) return "bound";

    // No role matched anything at all.
    if (counts.matchedMembers === 0) return "unresolved";

    // The cap dropped points that HAD resolved. Ranked above `partial` because
    // the administrator's remedy differs: the widget cannot hold them all, so
    // the fix is another widget rather than another point. `matchedMembers` and
    // `boundPoints` still show the size of the gap either way.
    if (counts.boundPoints < counts.candidates) return "truncated";

    // Some binding came up short — either it matched members that carry no such
    // point, or it matched nothing while a sibling binding did.
    if (!counts.everyBindingWhole) return "partial";

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
      .where(and(eq(dashboardWidgets.dashboardId, dashboardId), eq(dashboardWidgets.organizationId, organizationId)))
      .orderBy(asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));

    const widgets = [];
    for (const widget of widgetRows) {
      // `resolveBoundPoints`, not a hand-written select (review finding, F3.43). This method is
      // the SECOND producer of `dashboardWidgetPointDtoSchema` rows, and the first one the ADR
      // 0069 sweep did not enumerate: its own select lacked `assetCode`, and because the parse
      // below takes `unknown`, the compiler said nothing — every instantiation whose bindings
      // resolved to a point committed the dashboard and then answered 500 from the read-back.
      // The shared resolver carries the organization predicate on both join legs (its file
      // docblock says why the fleet pool needs that) and every column the contract names, so
      // a future widening reaches this producer through the type, not through a 500.
      const points = await resolveBoundPoints(this.fleetDb, organizationId, [widget.id]);

      const sources = await this.fleetDb
        .select({
          id: dashboardWidgetSources.id,
          catalogKey: dashboardWidgetSources.catalogKey,
          params: dashboardWidgetSources.params,
          sortOrder: dashboardWidgetSources.sortOrder,
        })
        .from(dashboardWidgetSources)
        .where(and(eq(dashboardWidgetSources.widgetId, widget.id), eq(dashboardWidgetSources.organizationId, organizationId)))
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
          assetCode: point.assetCode,
          pointKey: point.pointKey,
          unit: point.unit,
        })),
        sources,
        widgetType: widget.widgetType,
        config: widget.config,
      });
    }

    const dto = {
      id: row.id,
      organizationId: row.organizationId,
      slug: row.slug,
      name: row.name,
      description: row.description,
      locationId: row.locationId,
      assetGroupId: row.assetGroupId,
      assetId: row.assetId,
      assetTemplateId: row.assetTemplateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      widgets,
    };
    return parseStoredContract(
      dashboardDtoSchema,
      dto,
      "dashboard_templates_instantiate.read_back.dto",
    );
  }
}
