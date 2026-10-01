import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  assetDomains,
  assetGroupMembers,
  assetGroups,
  assets,
  dashboards,
  dashboardTemplates,
  dashboardWidgetPoints,
  dashboardWidgets,
  dashboardWidgetSources,
  locations,
  siteControlRoomViews,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  groupsToCreate,
  planSiteLayout,
  planTemplateWidget,
  sectionTemplateContentSchema,
  siteLayoutDashboardSlug,
} from "@bms/shared";
import type {
  JwtPayload,
  SectionTemplateContent,
  SiteLayoutAmbiguousDto,
  SiteLayoutAmbiguousTab,
  SiteLayoutBulkResultDto,
  SiteLayoutChoice,
  SiteLayoutGroup,
  SiteLayoutResultDto,
  SiteLayoutSkipReason,
} from "@bms/shared";

import type { SiteTemplateArm } from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import { TEMPLATE_TARGET_BODY_MESSAGE } from "../admin/dashboard-templates/dashboard-templates.schema";
import { loadActivePoints, loadMembersByRole } from "../admin/dashboard-templates/template-resolution.reads";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { parseStoredContract } from "../common/parse-stored-contract";
import { writeDashboardTabs } from "../dashboard-builder/dashboard-tabs-write";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { type BmsTx, withTenant } from "../database/tenant-context";
import {
  NO_SITE_TEMPLATE_MESSAGE,
  SITE_HAS_NO_ASSETS_MESSAGE,
  SITE_HAS_VIEW_MESSAGE,
  SITE_LAYOUT_AMBIGUOUS_MESSAGE,
  SITE_LAYOUT_CHOICE_MESSAGES,
  SITE_LAYOUT_SLUG_TAKEN_MESSAGE,
  SITE_TEMPLATE_NOT_FOUND_MESSAGE,
} from "./site-layout.schema";

/**
 * `F3.73` plan D6 (rulings Q3a, Q4, Q4b, Q5) — the site-layout copy action: copy one published
 * `target = 'site'` template onto one site as a tabbed dashboard, and point the site's Control
 * Room view at it. Three doors reach it: the per-site notice action
 * (`POST /admin/locations/:id/site-layout`), the site arm of `instantiate` (the `SITE_TEMPLATE_ARM`
 * seam), and the bulk backfill (`POST /admin/dashboard-templates/:id/apply-to-sites`).
 *
 * **One `withTenant` transaction per site.** Groups, dashboard, tabs, widgets, points, sources,
 * the view row and the audits commit together or not at all. The plan (group pick, card drop,
 * widget resolution) runs BEFORE the first write, so an ambiguous or refused site writes nothing
 * even before the rollback; the groups a zero-group site needs are planned under placeholder ids
 * and made only once the plan is `planned`.
 *
 * **One copy per site at a time.** The transaction's first statement is a per-site advisory
 * lock (`siteLayoutLockKey`), so a second concurrent copy reads the first one's committed view
 * row and answers 409 — never a raw `23505` on a group or the slug.
 *
 * **Never replaces a builtin or live row (ruling Q4).** The view-row read is advisory; the write
 * is the rule. A site with no row gets an `INSERT … ON CONFLICT DO NOTHING` that must write one
 * row, never an upsert. A site whose row is a **removed copy** — `kind = 'dashboard'` with
 * `dashboard_id` NULL, which `0082`'s `ON DELETE SET NULL` leaves when an administrator deletes
 * the copy — has that row re-pointed in place by an `UPDATE` whose `WHERE` restates the
 * removed-copy predicate and must match one row. Either miss is a 409 and rolls the copy back.
 *
 * **Permissions (plan D6), in this order:** `requireMasterDataUser`, then `canManageLocation`
 * (403, the `putSetting` pair), then `canManageDashboard` on the location scope (404, the
 * dashboards precedent). The bulk action is an organization-wide act: `organization_admin` or
 * `admin`, the `DashboardTemplatesService.assertCanAuthor` rule.
 *
 * **Reads before the transaction run on `fleetDb` with an explicit `organization_id`** (BYPASSRLS);
 * reads inside it run on the tenant transaction, so a group made in it is visible to the plan.
 */

/**
 * The per-site advisory-lock key (the `report-files.service.ts` shape). Every copy action on a
 * site takes it first, so two concurrent copies — a double-click, two admins, a bulk run beside a
 * per-site click — run one after the other: the second reads the first's committed view row and
 * answers 409, instead of colliding on `asset_groups_location_code_idx` or the dashboard slug.
 */
export function siteLayoutLockKey(locationId: string): string {
  return `site_layout:${locationId}`;
}

/**
 * The `instantiate` site arm (the `SITE_TEMPLATE_ARM` seam) over this service. `AdminModule`'s
 * factory is this function, so the integration spec drives the arm the module provides.
 */
export function siteTemplateArmOf(siteLayout: SiteLayoutService): SiteTemplateArm {
  return (jwt, template, body) =>
    siteLayout.makeForSite(jwt, {
      locationId: body.locationId,
      templateId: template.id,
      ...(body.tabGroups !== undefined ? { tabGroups: body.tabGroups } : {}),
    });
}

/** A placeholder id for a group the plan needs and the transaction has not made yet. */
const PLANNED_GROUP_PREFIX = "planned:";

type SiteRow = { id: string; organizationId: string; slug: string; name: string };

type SiteTemplate = {
  id: string;
  organizationId: string;
  code: string;
  version: number;
  name: string;
  content: SectionTemplateContent;
};

type TemplateRow = typeof dashboardTemplates.$inferSelect;

/** The view row the pre-check reads. `protected` in the service so a spec can stage a race. */
export type SiteViewRowForCopy = { kind: string; dashboardId: string | null };

/** The planner's readonly ambiguous list, as the contract's plain arrays. */
function mutableAmbiguous(list: readonly SiteLayoutAmbiguousTab[]): SiteLayoutAmbiguousDto["ambiguous"] {
  return list.map((tab) => ({ tabKey: tab.tabKey, domain: tab.domain, candidates: tab.candidates.map((c) => ({ ...c })) }));
}

/**
 * A 409 that says which bulk skip it is. The ambiguous one carries the candidates in its body
 * (plan D5: the web's picker needs no second read); the others carry Nest's default shape.
 */
export class SiteLayoutConflict extends ConflictException {
  constructor(
    readonly reason: SiteLayoutSkipReason,
    message: string,
    readonly ambiguous?: readonly SiteLayoutAmbiguousTab[],
  ) {
    super(
      ambiguous === undefined
        ? message
        : { statusCode: 409, error: "Conflict", message, ambiguous: mutableAmbiguous(ambiguous) },
    );
  }
}

@Injectable()
export class SiteLayoutService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  /** The per-site action, and the `instantiate` site arm (which passes `templateId`). */
  async makeForSite(
    jwt: JwtPayload,
    input: { locationId: string; templateId?: string; tabGroups?: SiteLayoutChoice },
  ): Promise<SiteLayoutResultDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.accessControl.canManageLocation(jwt, input.locationId))) {
      throw new ForbiddenException("Location is outside your access scope");
    }
    const site = await this.readSite(input.locationId);
    if (
      !(await this.accessControl.canManageDashboard(jwt, site.organizationId, {
        locationId: site.id,
        assetGroupId: null,
        assetId: null,
      }))
    ) {
      throw new NotFoundException("Location not found or outside your access scope");
    }

    // The template is read under the SITE's organization, so the `instantiate` arm cannot copy
    // one organization's template onto another organization's site: that reads as not found.
    const template =
      input.templateId === undefined
        ? await this.newestPublishedSiteTemplate(site.organizationId)
        : this.checkedTemplate(await this.readTemplate(input.templateId, site.organizationId));

    const updatedBy = await this.provisionedUserId(user.id);
    return this.makeOne(jwt, site, template, input.tabGroups ?? {}, updatedBy);
  }

  /**
   * The bulk backfill (ruling Q4): every active site of the template's organization, one
   * transaction each. A skip is reported, never raised; a site made stays made when a later one
   * is skipped. A refused choice cannot happen here (the bulk body carries none).
   */
  async makeForOrganization(jwt: JwtPayload, templateId: string): Promise<SiteLayoutBulkResultDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    const row = await this.readTemplate(templateId);
    // Authorship before the status and target checks, so a caller who may not author in the
    // organization learns nothing about the template.
    if (user.role === "location_admin" || !(await this.accessControl.canManageTemplate(jwt, row.organizationId))) {
      throw new ForbiddenException("Only an organization admin can apply a site template to every site");
    }
    const template = this.checkedTemplate(row);

    const sites = await this.fleetDb
      .select({ id: locations.id, organizationId: locations.organizationId, slug: locations.slug, name: locations.name })
      .from(locations)
      .where(and(eq(locations.organizationId, template.organizationId), eq(locations.active, true)))
      .orderBy(asc(locations.code));

    const updatedBy = await this.provisionedUserId(user.id);
    const made: SiteLayoutResultDto[] = [];
    const skipped: SiteLayoutBulkResultDto["skipped"] = [];
    for (const site of sites) {
      try {
        made.push(await this.makeOne(jwt, site, template, {}, updatedBy));
      } catch (err) {
        if (!(err instanceof SiteLayoutConflict)) {
          throw err;
        }
        skipped.push({
          locationId: site.id,
          reason: err.reason,
          ...(err.ambiguous !== undefined ? { ambiguous: mutableAmbiguous(err.ambiguous) } : {}),
        });
      }
    }
    return { made, skipped };
  }

  /**
   * The stored view row, read inside the copy's transaction. Advisory: the write re-states the
   * rule. `protected` so the integration spec can stage the race the write exists for.
   */
  protected async readViewRow(tx: BmsTx, locationId: string): Promise<SiteViewRowForCopy | null> {
    const [row] = await tx
      .select({ kind: siteControlRoomViews.kind, dashboardId: siteControlRoomViews.dashboardId })
      .from(siteControlRoomViews)
      .where(eq(siteControlRoomViews.locationId, locationId))
      .limit(1);
    return row ?? null;
  }

  /** One site, one transaction: plan, then write. */
  private async makeOne(
    jwt: JwtPayload,
    site: SiteRow,
    template: SiteTemplate,
    choice: SiteLayoutChoice,
    updatedBy: string | null,
  ): Promise<SiteLayoutResultDto> {
    const organizationId = site.organizationId;
    const slug = siteLayoutDashboardSlug(site.slug);
    try {
      return await withTenant(this.tenantDb, organizationId, async (tx) => {
        // First: a concurrent copy on this site waits here, then reads the committed view row.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${siteLayoutLockKey(site.id)}, 0))`);
        const view = await this.readViewRow(tx, site.id);
        const removedCopy = view !== null && view.kind === "dashboard" && view.dashboardId === null;
        if (view !== null && !removedCopy) {
          throw new SiteLayoutConflict("has_view", SITE_HAS_VIEW_MESSAGE);
        }

        const groups: SiteLayoutGroup[] = await tx
          .select({ id: assetGroups.id, code: assetGroups.code, name: assetGroups.name, domain: assetGroups.domain })
          .from(assetGroups)
          .where(and(eq(assetGroups.locationId, site.id), eq(assetGroups.organizationId, organizationId)))
          .orderBy(asc(assetGroups.code));
        const siteAssets = await tx
          .select({ id: assets.id, domain: assets.domain })
          .from(assets)
          .where(and(eq(assets.locationId, site.id), eq(assets.organizationId, organizationId), eq(assets.active, true)))
          .orderBy(asc(assets.code));
        if (siteAssets.length === 0) {
          throw new SiteLayoutConflict("no_assets", SITE_HAS_NO_ASSETS_MESSAGE);
        }

        // Ruling Q4b — a site with no group gets one per domain present, planned before it is made.
        const toCreate = groupsToCreate(siteAssets, groups);
        const labels = await this.domainLabels(tx, toCreate.map((group) => group.domain));
        const planned: SiteLayoutGroup[] = toCreate.map((group) => ({
          id: `${PLANNED_GROUP_PREFIX}${group.code}`,
          code: group.code,
          name: labels.get(group.domain) ?? group.domain,
          domain: group.domain,
        }));

        const plan = planSiteLayout(template.content.tabs, [...groups, ...planned], choice);
        if (plan.status === "refused") {
          const [first] = plan.refused;
          throw new BadRequestException(SITE_LAYOUT_CHOICE_MESSAGES[first?.reason ?? "unknown_group"]);
        }
        if (plan.status === "ambiguous") {
          throw new SiteLayoutConflict("ambiguous", SITE_LAYOUT_AMBIGUOUS_MESSAGE, plan.ambiguous);
        }

        // --- writes ---------------------------------------------------------------------------
        const realId = new Map<string, string>();
        for (const group of toCreate) {
          const name = labels.get(group.domain) ?? group.domain;
          const [row] = await tx
            .insert(assetGroups)
            .values({ organizationId, locationId: site.id, code: group.code, name, domain: group.domain })
            .returning({ id: assetGroups.id });
          const groupId = row?.id as string;
          realId.set(`${PLANNED_GROUP_PREFIX}${group.code}`, groupId);
          await tx
            .insert(assetGroupMembers)
            .values(group.assetIds.map((assetId) => ({ assetGroupId: groupId, assetId, role: null })));
          await this.audit.write(
            {
              actor: jwt,
              organizationId,
              action: "master.asset_group.create",
              entityType: "asset_group",
              entityId: groupId,
              reason: "made by the site-layout copy action for a site with no asset group",
              payload: { locationId: site.id, code: group.code, domain: group.domain, members: group.assetIds.length },
            },
            tx,
          );
        }
        const groupIdOf = (group: SiteLayoutGroup | null): string | null =>
          group === null ? null : (realId.get(group.id) ?? group.id);

        const [dashboardRow] = await tx
          .insert(dashboards)
          .values({
            organizationId,
            slug,
            name: `${template.name} — ${site.name}`.slice(0, 255),
            description: null,
            locationId: site.id,
            // ADR 0049 decision 2 — the version stamp; the web knows a copy by it (ruling Q5).
            templateId: template.id,
          })
          .returning({ id: dashboards.id });
        const dashboardId = dashboardRow?.id as string;

        const tabIds = await writeDashboardTabs(tx, { organizationId, dashboardId, locationId: site.id }, [], {
          updates: [],
          inserts: plan.tabs.map((row) => ({
            key: row.tab.key,
            label: row.tab.label,
            sortOrder: row.tab.sortOrder,
            assetGroupId: groupIdOf(row.group),
          })),
          deleteIds: [],
          unchangedIds: [],
        });

        const pointsByAsset = await loadActivePoints(tx, organizationId);
        const resolution: SiteLayoutResultDto["resolution"] = [];
        for (const row of plan.tabs) {
          const groupId = groupIdOf(row.group);
          const members = groupId === null ? new Map() : await loadMembersByRole(tx, groupId, organizationId);
          const plans = row.tab.widgets.map((widget) => planTemplateWidget(widget, members, pointsByAsset));
          await this.writeWidgets(tx, organizationId, dashboardId, tabIds.get(row.tab.key) ?? null, plans);
          resolution.push({
            tabKey: row.tab.key,
            assetGroupId: groupId,
            via: row.via,
            widgets: plans.map((p) => p.resolution),
          });
        }

        await this.pointViewAt(tx, site.id, organizationId, dashboardId, removedCopy, updatedBy);

        await this.audit.write(
          {
            actor: jwt,
            organizationId,
            action: "master.location.site_layout.make",
            entityType: "location",
            entityId: site.id,
            reason: `from template ${template.code} v${template.version}`,
            payload: {
              dashboardId,
              templateId: template.id,
              tabs: plan.tabs.map((row) => row.tab.key),
              omittedTabs: plan.omitted.map((tab) => tab.tabKey),
              droppedCards: plan.droppedCards.length,
              createdGroups: toCreate.length,
              replacedRemovedCopy: removedCopy,
            },
          },
          tx,
        );
        await this.audit.write(
          {
            actor: jwt,
            organizationId,
            action: "master.location.control_room_view.set",
            entityType: "site_control_room_view",
            entityId: site.id,
            payload: { kind: "dashboard", dashboardId },
          },
          tx,
        );

        return {
          locationId: site.id,
          dashboardId,
          dashboardSlug: slug,
          omittedTabs: plan.omitted.map((tab) => ({ tabKey: tab.tabKey, domain: tab.domain })),
          droppedCards: [...plan.droppedCards],
          resolution,
        };
      });
    } catch (err) {
      // Drizzle throws on a 23505, and the transaction is already rolled back. The constraint
      // name, never the message: the message would echo the slug and the organization.
      const constraint = (err as { constraint?: string } | null)?.constraint;
      if (constraint === "dashboards_organization_slug_key") {
        throw new SiteLayoutConflict("slug_taken", SITE_LAYOUT_SLUG_TAKEN_MESSAGE);
      }
      throw err;
    }
  }

  /**
   * Point the site's view at the copy. The pre-check was advisory; this is the rule, and a miss
   * rolls the whole copy back. A removed copy is re-pointed in place — the `WHERE` restates the
   * removed-copy predicate, so a row that became live after the read is never overwritten. A
   * site with no row gets an insert that must write one row — never an upsert.
   */
  private async pointViewAt(
    tx: BmsTx,
    locationId: string,
    organizationId: string,
    dashboardId: string,
    removedCopy: boolean,
    updatedBy: string | null,
  ): Promise<void> {
    const updatedAt = new Date();
    const written = removedCopy
      ? await tx
          .update(siteControlRoomViews)
          .set({ dashboardId, updatedAt, updatedBy })
          .where(
            and(
              eq(siteControlRoomViews.locationId, locationId),
              eq(siteControlRoomViews.kind, "dashboard"),
              isNull(siteControlRoomViews.dashboardId),
            ),
          )
          .returning({ locationId: siteControlRoomViews.locationId })
      : await tx
          .insert(siteControlRoomViews)
          .values({ locationId, organizationId, kind: "dashboard", dashboardId, builtinKey: null, updatedAt, updatedBy })
          .onConflictDoNothing({ target: siteControlRoomViews.locationId })
          .returning({ locationId: siteControlRoomViews.locationId });
    if (written.length !== 1) {
      throw new SiteLayoutConflict("has_view", SITE_HAS_VIEW_MESSAGE);
    }
  }

  /** The widgets of one tab, with their points and sources — the `instantiate` loop, per tab. */
  private async writeWidgets(
    tx: BmsTx,
    organizationId: string,
    dashboardId: string,
    tabId: string | null,
    plans: readonly ReturnType<typeof planTemplateWidget>[],
  ): Promise<void> {
    for (const plan of plans) {
      const [widgetRow] = await tx
        .insert(dashboardWidgets)
        .values({
          organizationId,
          dashboardId,
          tabId,
          widgetType: plan.widget.widgetType,
          title: plan.widget.title,
          gridX: plan.widget.gridX,
          gridY: plan.widget.gridY,
          gridW: plan.widget.gridW,
          gridH: plan.widget.gridH,
          config: plan.widget.config,
        })
        .returning({ id: dashboardWidgets.id });
      const widgetId = widgetRow?.id as string;
      if (plan.points.length > 0) {
        await tx.insert(dashboardWidgetPoints).values(
          plan.points.map((point, index) => ({
            organizationId,
            widgetId,
            pointId: point.pointId,
            role: plan.pointRole,
            sortOrder: index,
          })),
        );
      }
      if (plan.widget.sources.length > 0) {
        await tx.insert(dashboardWidgetSources).values(
          plan.widget.sources.map((source, index) => ({
            organizationId,
            widgetId,
            catalogKey: source.catalogKey,
            params: source.params,
            sortOrder: source.sortOrder ?? index,
          })),
        );
      }
    }
  }

  private async domainLabels(tx: BmsTx, codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) {
      return new Map();
    }
    const rows = await tx
      .select({ code: assetDomains.code, label: assetDomains.label })
      .from(assetDomains)
      .where(inArray(assetDomains.code, [...codes]));
    return new Map(rows.map((row) => [row.code, row.label]));
  }

  private async readSite(locationId: string): Promise<SiteRow> {
    const [site] = await this.fleetDb
      .select({ id: locations.id, organizationId: locations.organizationId, slug: locations.slug, name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    if (!site) {
      throw new NotFoundException("Location not found or outside your access scope");
    }
    return site;
  }

  /** One template by id — within `organizationId` when one is given (the per-site path). */
  private async readTemplate(templateId: string, organizationId?: string): Promise<TemplateRow> {
    const byId = eq(dashboardTemplates.id, templateId);
    const [row] = await this.fleetDb
      .select()
      .from(dashboardTemplates)
      .where(organizationId === undefined ? byId : and(byId, eq(dashboardTemplates.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException(SITE_TEMPLATE_NOT_FOUND_MESSAGE);
    }
    return row;
  }

  /** OQ4 — the organization's newest published site template, by `published_at`. */
  private async newestPublishedSiteTemplate(organizationId: string): Promise<SiteTemplate> {
    const [row] = await this.fleetDb
      .select()
      .from(dashboardTemplates)
      .where(
        and(
          eq(dashboardTemplates.organizationId, organizationId),
          eq(dashboardTemplates.target, "site"),
          eq(dashboardTemplates.status, "published"),
        ),
      )
      .orderBy(sql`${dashboardTemplates.publishedAt} DESC NULLS LAST`, desc(dashboardTemplates.version))
      .limit(1);
    if (!row) {
      throw new ConflictException(NO_SITE_TEMPLATE_MESSAGE);
    }
    return this.checkedTemplate(row);
  }

  /** Only a published site template with at least one tab copies. */
  private checkedTemplate(row: TemplateRow): SiteTemplate {
    if (row.status !== "published") {
      throw new ConflictException(`Only a published template can be instantiated; this one is ${row.status}`);
    }
    if (row.target !== "site") {
      throw new BadRequestException(TEMPLATE_TARGET_BODY_MESSAGE);
    }
    const content = parseStoredContract(sectionTemplateContentSchema, row.content, "site_layout.read_template.content");
    if (content.tabs.length === 0) {
      throw new BadRequestException("This template has no widgets to instantiate");
    }
    return {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      version: row.version,
      name: row.name,
      content,
    };
  }

  /** `updated_by` takes an id read back from `bms.users` (the `SiteControlRoomViewService` rule). */
  private async provisionedUserId(userId: string): Promise<string | null> {
    const [row] = await this.fleetDb.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.id ?? null;
  }
}
