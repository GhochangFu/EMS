import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  Optional,
} from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";

import {
  assetGroups,
  dashboards,
  dashboardWidgetPoints,
  dashboardWidgets,
  dashboardWidgetSources,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  dashboardDtoSchema,
  planTemplateWidget,
  sectionTemplateContentSchema,
  templateWidgets,
} from "@bms/shared";
import type {
  DashboardTemplateTarget,
  GroupMember,
  InstantiateSectionTemplateResponse,
  JwtPayload,
  SectionTemplateContent,
} from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
// `F4.108` / ADR 0060 ruling 2 — both parses below read stored data: a
// template's `content` column, and the dashboard this service has just written
// and read back. Neither can be the caller's fault, so neither may become a 400.
import { parseStoredContract } from "../../common/parse-stored-contract";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../../database/database.tokens";
import { withTenant } from "../../database/tenant-context";
import { resolveBoundPoints } from "../../dashboard-builder/dashboard-point-scope";
import { MIMIC_SCOPE_MESSAGE } from "../../dashboard-builder/dashboards.schema";
import { MasterDataAuditService } from "../master-data-audit.service";
import { templateTargetBodyMessage } from "./dashboard-templates.schema";
import type {
  InstantiateGroupTemplateBody,
  InstantiateSectionTemplateBody,
  InstantiateSiteTemplateBody,
} from "./dashboard-templates.schema";
import { DashboardTemplatesService } from "./dashboard-templates.service";
import { loadActivePoints, loadMembersByRole } from "./template-resolution.reads";

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
 *
 * ---
 *
 * **`F3.73` (ruling Q3a, plan D6) GAVE IT A THIRD: THE SITE ARM.** A template
 * whose `target` is `site` takes `{ locationId, tabGroups? }` and is copied onto
 * that location by the site-layout copy action, which owns the group picking,
 * the tabs and the site view row. This service only routes to it, through ONE
 * optional seam (`SITE_TEMPLATE_ARM`), which `AdminModule` fills from
 * `SiteLayoutService` (PR4); a module that does not provide it answers 501
 * `SITE_ARM_NOT_WIRED_MESSAGE`. The
 * per-widget plan (`planTemplateWidget`) moved to `@bms/shared` for the same
 * reason — the copy action and the seed plan widgets with it too.
 */

/** `F3.73` plan Task 2.2 — the answer while no site arm is provided (PR4 wires it). */
export const SITE_ARM_NOT_WIRED_MESSAGE =
  "Instantiating a site template is not available yet: the site-layout copy action is not wired";

/**
 * The seam the site-layout copy action fills (plan D6, PR4). A Nest token rather than a
 * constructor type, because a function type carries no runtime token: without it the module
 * fails at boot while `tsc` stays green.
 */
export const SITE_TEMPLATE_ARM = Symbol("SITE_TEMPLATE_ARM");

/** What the site arm answers. The copy action answers `SiteLayoutResultDto` (plan D6); this seam
 * only passes it on, so it stays `object` and the seam specs may stub any answer. */
export type SiteTemplateArmResult = object;

/**
 * The site arm: copy one published site template onto one location. It is called after this
 * service has proved readability, authorship, the published status, the body/target fit and
 * the stored content's target fit; the location and dashboard permissions are its own (D6).
 */
export type SiteTemplateArm = (
  jwt: JwtPayload,
  template: { readonly id: string; readonly organizationId: string },
  body: InstantiateSiteTemplateBody,
) => Promise<SiteTemplateArmResult>;

@Injectable()
export class DashboardTemplatesInstantiateService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly templates: DashboardTemplatesService,
    @Optional() @Inject(SITE_TEMPLATE_ARM) private readonly siteArm?: SiteTemplateArm,
  ) {}

  /**
   * The checks both arms share, in this order: readability, the published status, and the
   * body/target fit. The controller picks the arm by the body's shape; this is what refuses a
   * body whose arm is not the stored template's.
   */
  private async loadPublished(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateSectionTemplateBody,
  ): Promise<{
    template: Awaited<ReturnType<DashboardTemplatesService["fetchRow"]>>;
    target: DashboardTemplateTarget;
  }> {
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

    // `F3.73` plan D6 — which arm a template takes is its stored `target`; the body must match.
    // After readability, so a caller who may not read the template learns nothing of its target.
    const target = template.target as DashboardTemplateTarget;
    const mismatch = templateTargetBodyMessage(target, body);
    if (mismatch !== null) {
      throw new BadRequestException(mismatch);
    }
    return { template, target };
  }

  /**
   * The pinned version's stored `content`, parsed. One call site for both arms, so one
   * `StoredContractContext` literal still names which parse raised a 500 (`F4.108`).
   */
  private parseContent(stored: unknown): SectionTemplateContent {
    return parseStoredContract(
      sectionTemplateContentSchema,
      stored,
      "dashboard_templates_instantiate.instantiate.content",
    );
  }

  /** The asset-group arm (and `E4.2`'s organization-wide case of it). */
  async instantiate(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateGroupTemplateBody,
  ): Promise<InstantiateSectionTemplateResponse> {
    const { template, target } = await this.loadPublished(jwt, templateId, body);

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

    const content = this.parseContent(template.content);
    // `F3.73` — re-proved from the stored row: an asset-group template holds no tabs, so the
    // top-level list below is every widget it has.
    this.templates.assertContentFitsTarget(target, content);
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
    /**
     * `F3.32` / ADR 0079 decision 4 — checked FIRST, and as its own guard rather than folded
     * into the role-bindings one below. A `mimic` widget binds NO role at all (`widgetType`
     * `mimic`'s `WIDGET_POINT_CARDINALITY`/`WIDGET_SOURCE_CARDINALITY` are both `{min:0,max:0}`,
     * `F3.32` U0), so `content.widgets.some((w) => w.bindings.length > 0)` below would never see
     * it — a mimic-only template would otherwise sail past the role-bindings guard and land
     * organization-wide, where its nodes resolve against no group at all. The two guards throw
     * different sentences on purpose: a caller who fixes "add an asset group" for the wrong
     * reason still fixes it, but a test asserting on the WRONG message would never catch this
     * guard being dropped.
     */
    if (body.assetGroupId === null && content.widgets.some((w) => w.widgetType === "mimic")) {
      throw new BadRequestException(MIMIC_SCOPE_MESSAGE);
    }

    if (body.assetGroupId === null && content.widgets.some((w) => w.bindings.length > 0)) {
      throw new BadRequestException("A template with role bindings needs an asset group");
    }

    // Both maps are empty on the organization-wide arm: there is no group to
    // read members from, and with no bindings there is no point to look up.
    // `planTemplateWidget` still runs for every widget — Amendment 2 decision 1 wants a
    // resolution entry per widget, and a zero-binding widget is already `bound`.
    const members =
      body.assetGroupId === null
        ? new Map<string, GroupMember[]>()
        : await loadMembersByRole(this.fleetDb, body.assetGroupId, template.organizationId);
    const pointsByAsset =
      body.assetGroupId === null
        ? new Map<string, string>()
        : await loadActivePoints(this.fleetDb, template.organizationId);

    // `F3.73` — the plan moved to `@bms/shared` (`template-instantiation.ts`), byte for byte.
    const plans = content.widgets.map((widget) =>
      planTemplateWidget(widget, members, pointsByAsset),
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
   * The site arm — `F3.73` ruling Q3a, plan D6.
   *
   * **Authorship, not only readability.** The group arm deploys a published template into the
   * caller's own scope and asks readability plus a check on the target. The plan gives the
   * site arm `assertCanAuthor` before delegating: a copy writes a whole tabbed layout and its
   * site view row, and the per-site notice action (plan D6) is the location admin's door.
   *
   * The stored content is re-proved against the target here, so the seam never receives a
   * site template holding top-level widgets or no widget at all.
   */
  async instantiateSite(
    jwt: JwtPayload,
    templateId: string,
    body: InstantiateSiteTemplateBody,
  ): Promise<SiteTemplateArmResult> {
    const { template, target } = await this.loadPublished(jwt, templateId, body);
    await this.templates.assertCanAuthor(jwt, template.organizationId);
    const content = this.parseContent(template.content);
    this.templates.assertContentFitsTarget(target, content);
    if (templateWidgets(content).length === 0) {
      throw new BadRequestException("This template has no widgets to instantiate");
    }
    if (this.siteArm === undefined) {
      throw new NotImplementedException(SITE_ARM_NOT_WIRED_MESSAGE);
    }
    return this.siteArm(jwt, { id: template.id, organizationId: template.organizationId }, body);
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
        tabId: widget.tabId,
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
      templateId: row.templateId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      // `F3.73` (plan D1) — empty by construction: this instantiation writes no tab, and the
      // dashboard it read back was created in the same call. The parse below takes `unknown`,
      // so an omitted key here compiles and answers 500 from every instantiation.
      tabs: [],
      widgets,
    };
    return parseStoredContract(
      dashboardDtoSchema,
      dto,
      "dashboard_templates_instantiate.read_back.dto",
    );
  }
}
