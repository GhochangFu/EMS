import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, isNotNull, isNull, not, notExists, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  dashboards,
  dashboardTemplates,
  dashboardWidgets,
  organizationControlRoomViews,
  organizations,
  users,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  NO_ORGANIZATION_TEMPLATE_MESSAGE,
  ORGANIZATION_HAS_LAYOUT_MESSAGE,
  planTemplateWidget,
  sectionTemplateContentSchema,
  TEMPLATE_TARGET_BODY_MESSAGE,
  valueTileConfigSchema,
} from "@bms/shared";
import type {
  JwtPayload,
  MetricCatalogKey,
  OrganizationControlRoomViewDto,
  OrganizationLayoutResultDto,
  OrganizationStripTileDto,
  PutOrganizationControlRoomViewBody,
  SectionTemplateWidget,
} from "@bms/shared";
import { ORGANIZATION_STANDARD_TEMPLATE } from "@bms/shared/site-templates";

import type { OrganizationTemplateArm } from "../admin/dashboard-templates/dashboard-templates-instantiate.service";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { OrganizationViewAccessService } from "../auth/organization-view-access.service";
import { parseStoredContract } from "../common/parse-stored-contract";
import { resolveWidgetSources } from "../dashboard-builder/dashboard-source-scope";
import type { CatalogBindings } from "../dashboard-builder/metric-catalog-plan";
import { MetricCatalogService } from "../dashboard-builder/metric-catalog.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { writeLayoutWidgets } from "./layout-copy-writes";

/**
 * `F4.317` task 4.2 (ADR 0112 decisions 3, 4 and 5) — the organization Control Room strip: the
 * read, "Make organization layout" and "Reset to default".
 *
 * **The read applies the fail-safe (decision 3).** No view row, a row whose dashboard is gone
 * (`0126`'s `ON DELETE SET NULL`), or a row whose dashboard is not this organization's
 * organization-wide dashboard all draw the stock `organization-standard` content, so every
 * organization has the strip with no admin action. A copy that someone re-scoped to a site in the
 * builder is therefore ignored rather than shown at organization level.
 *
 * **Every tile resolves over the caller's readable assets of the organization (decision 5)**,
 * through `MetricCatalogService.resolveBindings` at organization scope (all three scope axes
 * null: `resolveAssetScope` falls to the organization's assets ∩ `readableAssetIds`). Who may
 * change the strip does not change what each reader sees.
 *
 * **The copy is one `withTenant` transaction** (the `SiteLayoutService.makeOne` shape): an
 * advisory lock per organization first, so two concurrent "Make" clicks run one after the other
 * and the second reads the first's committed row; then the dashboard, its widgets and sources, the
 * pointer row and the audits. **It never replaces a live layout (ruling Q2)**, and a live layout
 * is exactly what the read draws (`qualifyingCopy`, one predicate for both): a row whose copy
 * qualifies is a 409 "Reset to default first"; a row the read ignores (its copy removed, or
 * re-scoped to a site) is re-pointed in place by an `UPDATE` that restates the not-qualifying
 * predicate; no row gets an insert that must write one row. Either miss rolls the copy back as
 * the same 409.
 *
 * **Reset deletes the row only.** The copy stays, as an ordinary organization-wide dashboard.
 *
 * **A row pointed at another organization's dashboard** can only be written past the policy (a
 * BYPASSRLS or superuser repair; `WITH CHECK` refuses it), and `0126`'s USING clause hides it from
 * the organization's own GUC, so neither tenant write could touch it. Make and Reset first clear
 * it on `fleetDb` with the organization and the foreign predicate explicit, audited
 * (`clearForeignPointer`); without that the organization would be stuck on the stock strip.
 *
 * **Reads before the transaction run on `fleetDb` (BYPASSRLS) with the organization predicate
 * explicit**; the writes run under the organization's GUC, so `0126`'s two-leg policy is the
 * backstop behind the same-organization rule this service enforces first.
 */

/** The per-organization advisory-lock key (the `siteLayoutLockKey` shape). */
export function organizationLayoutLockKey(organizationId: string): string {
  return `organization_layout:${organizationId}`;
}

/** The slug of an organization's copy. Unique per copy: Reset leaves the old copy in place. */
export function organizationLayoutDashboardSlug(dashboardId: string): string {
  return `organization-layout-${dashboardId.slice(0, 8)}`;
}

/**
 * The `instantiate` organization arm (the `ORGANIZATION_TEMPLATE_ARM` seam) over this service.
 * `AdminModule`'s factory is this function. The instantiate service has proved the body's
 * organization is the template's own before it calls the arm.
 */
export function organizationTemplateArmOf(layout: OrganizationLayoutService): OrganizationTemplateArm {
  return (jwt, template, body) => layout.make(jwt, body.organizationId, { templateId: template.id });
}

const NOT_FOUND = "Organization not found or outside your access scope";
const MAY_NOT_CHANGE = "Only an administrator of this organization may change its Control Room strip";

/** The view of a stored view row: the copy it points at, when that copy still qualifies. */
type PointedCopy = { id: string; slug: string; name: string };

type OrganizationTemplate = {
  id: string;
  code: string;
  version: number;
  name: string;
  widgets: readonly SectionTemplateWidget[];
  stockVersion: number | null;
};

type TemplateRow = typeof dashboardTemplates.$inferSelect;

/** Organization-wide: no scope column set (ADR 0047 Amendment 2 ruling 2's shape). */
const ORGANIZATION_SCOPE = { locationId: null, assetGroupId: null, assetId: null } as const;

@Injectable()
export class OrganizationLayoutService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly viewAccess: OrganizationViewAccessService,
    private readonly audit: MasterDataAuditService,
    private readonly catalog: MetricCatalogService,
  ) {}

  /** `GET /control-room/organizations/:organizationId/view` — 404 when the caller cannot read it. */
  async view(jwt: JwtPayload, organizationId: string): Promise<OrganizationControlRoomViewDto> {
    const readable = await this.accessControl.readableOrganizationIds(jwt);
    if (readable !== null && !readable.includes(organizationId)) {
      throw new NotFoundException(NOT_FOUND);
    }
    await this.readOrganization(organizationId, NOT_FOUND);

    const copy = await this.pointedCopy(organizationId);
    const tiles = copy === null ? stockTiles() : await this.copyTiles(organizationId, copy.id);
    const { byId, resolvedAt } = await this.catalog.resolveBindings(
      organizationId,
      tiles.bindings,
      await this.accessControl.readableAssetIds(jwt),
      await this.accessControl.readableLocationIds(jwt),
      `organization view ${organizationId}`,
    );

    return {
      organizationId,
      kind: copy === null ? "stock" : "dashboard",
      dashboardId: copy?.id ?? null,
      dashboardSlug: copy?.slug ?? null,
      layoutName: copy?.name ?? ORGANIZATION_STANDARD_TEMPLATE.name,
      canManage: await this.viewAccess.canManageOrganizationView(jwt, organizationId),
      tiles: tiles.tiles.map((tile) => ({
        ...tile.tile,
        sources: tile.sourceIds.map(({ id, catalogKey, sortOrder }) => ({
          catalogKey,
          sortOrder,
          resolved: byId.get(id) ?? null,
        })),
      })),
      resolvedAt,
    };
  }

  /** `PUT …/view` and the instantiate organization arm — "Make organization layout". */
  async make(
    jwt: JwtPayload,
    organizationId: string,
    body: PutOrganizationControlRoomViewBody,
  ): Promise<OrganizationLayoutResultDto> {
    const user = await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.viewAccess.canManageOrganizationView(jwt, organizationId))) {
      throw new ForbiddenException(MAY_NOT_CHANGE);
    }
    await this.readOrganization(organizationId, NOT_FOUND);
    // The template is read under THIS organization, so another organization's id reads as not found.
    const template =
      body.templateId === undefined
        ? await this.newestPublishedTemplate(organizationId)
        : this.checkedTemplate(await this.readTemplate(body.templateId, organizationId));
    const updatedBy = await this.provisionedUserId(user.id);

    await this.clearForeignPointer(jwt, organizationId);

    const dashboardId = randomUUID();
    const slug = organizationLayoutDashboardSlug(dashboardId);
    try {
      return await withTenant(this.tenantDb, organizationId, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${organizationLayoutLockKey(organizationId)}, 0))`);
        const [row] = await tx
          .select({ live: qualifyingCopy(organizationId) })
          .from(organizationControlRoomViews)
          .where(eq(organizationControlRoomViews.organizationId, organizationId))
          .limit(1);
        if (row?.live === true) {
          throw new ConflictException(ORGANIZATION_HAS_LAYOUT_MESSAGE);
        }
        // A row the read ignores: its copy was removed, or no longer qualifies.
        const removedCopy = row !== undefined;

        await tx.insert(dashboards).values({
          id: dashboardId,
          organizationId,
          slug,
          name: template.name.slice(0, 255),
          description: null,
          ...ORGANIZATION_SCOPE,
          // ADR 0049 decision 2 — the version stamp; F4.305 — the stock version the copy holds.
          templateId: template.id,
          stockVersion: template.stockVersion,
        });
        // No bindings on an organization template (task 3.1), so no member or point resolves.
        await writeLayoutWidgets(
          tx,
          organizationId,
          dashboardId,
          null,
          template.widgets.map((widget) => planTemplateWidget(widget, new Map(), new Map())),
        );

        const updatedAt = new Date();
        const written = removedCopy
          ? await tx
              .update(organizationControlRoomViews)
              .set({ dashboardId, updatedAt, updatedBy })
              .where(
                and(
                  eq(organizationControlRoomViews.organizationId, organizationId),
                  not(qualifyingCopy(organizationId)),
                ),
              )
              .returning({ organizationId: organizationControlRoomViews.organizationId })
          : await tx
              .insert(organizationControlRoomViews)
              .values({ organizationId, dashboardId, updatedAt, updatedBy })
              .onConflictDoNothing({ target: organizationControlRoomViews.organizationId })
              .returning({ organizationId: organizationControlRoomViews.organizationId });
        if (written.length !== 1) {
          throw new ConflictException(ORGANIZATION_HAS_LAYOUT_MESSAGE);
        }

        await this.audit.write(
          {
            actor: jwt,
            organizationId,
            action: "master.organization.control_room_view.make",
            entityType: "organization_control_room_view",
            entityId: organizationId,
            reason: `from template ${template.code} v${template.version}`,
            payload: { dashboardId, templateId: template.id, tiles: template.widgets.length, replacedRemovedCopy: removedCopy },
          },
          tx,
        );
        return { organizationId, dashboardId, dashboardSlug: slug, templateId: template.id };
      });
    } catch (err) {
      // The constraint name, never the message (it would echo the slug and the organization).
      if ((err as { constraint?: string } | null)?.constraint === "dashboards_organization_slug_key") {
        throw new ConflictException("A layout dashboard with this slug already exists; try again");
      }
      throw err;
    }
  }

  /** `DELETE …/view` — "Reset to default": the row goes, the copy stays. Idempotent. */
  async reset(jwt: JwtPayload, organizationId: string): Promise<void> {
    await this.accessControl.requireMasterDataUser(jwt);
    if (!(await this.viewAccess.canManageOrganizationView(jwt, organizationId))) {
      throw new ForbiddenException(MAY_NOT_CHANGE);
    }
    await this.readOrganization(organizationId, NOT_FOUND);
    if (await this.clearForeignPointer(jwt, organizationId)) {
      return;
    }
    await withTenant(this.tenantDb, organizationId, async (tx) => {
      const removed = await tx
        .delete(organizationControlRoomViews)
        .where(eq(organizationControlRoomViews.organizationId, organizationId))
        .returning({ dashboardId: organizationControlRoomViews.dashboardId });
      if (removed.length === 0) {
        return;
      }
      await this.audit.write(
        {
          actor: jwt,
          organizationId,
          action: "master.organization.control_room_view.reset",
          entityType: "organization_control_room_view",
          entityId: organizationId,
          payload: { dashboardId: removed[0]?.dashboardId ?? null },
        },
        tx,
      );
    });
  }

  /**
   * Deletes `organizationId`'s row when it points at a dashboard that is not this organization's,
   * on `fleetDb` with both predicates explicit, and audits it as a Reset. `true` when it did. The
   * row is invisible under the organization's GUC (`0126`'s USING clause), so only this read sees it.
   */
  private async clearForeignPointer(jwt: JwtPayload, organizationId: string): Promise<boolean> {
    return this.fleetDb.transaction(async (tx) => {
      const removed = await tx
        .delete(organizationControlRoomViews)
        .where(
          and(
            eq(organizationControlRoomViews.organizationId, organizationId),
            isNotNull(organizationControlRoomViews.dashboardId),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(dashboards)
                .where(
                  and(
                    eq(dashboards.id, organizationControlRoomViews.dashboardId),
                    eq(dashboards.organizationId, organizationId),
                  ),
                ),
            ),
          ),
        )
        .returning({ dashboardId: organizationControlRoomViews.dashboardId });
      if (removed.length === 0) {
        return false;
      }
      await this.audit.write(
        {
          actor: jwt,
          organizationId,
          action: "master.organization.control_room_view.reset",
          entityType: "organization_control_room_view",
          entityId: organizationId,
          reason: "the row pointed at another organization's dashboard",
          payload: { dashboardId: removed[0]?.dashboardId ?? null, foreignPointer: true },
        },
        tx,
      );
      return true;
    });
  }

  /** The row's copy, when it is this organization's organization-wide dashboard; else `null`. */
  private async pointedCopy(organizationId: string): Promise<PointedCopy | null> {
    const [row] = await this.fleetDb
      .select({ id: dashboards.id, slug: dashboards.slug, name: dashboards.name })
      .from(organizationControlRoomViews)
      .innerJoin(dashboards, eq(dashboards.id, organizationControlRoomViews.dashboardId))
      .where(
        and(
          eq(organizationControlRoomViews.organizationId, organizationId),
          eq(dashboards.organizationId, organizationId),
          isNull(dashboards.locationId),
          isNull(dashboards.assetGroupId),
          isNull(dashboards.assetId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The copy's value tiles and their stored sources, read with the organization explicit. */
  private async copyTiles(organizationId: string, dashboardId: string): Promise<StripPlan> {
    const rows = await this.fleetDb
      .select({
        id: dashboardWidgets.id,
        title: dashboardWidgets.title,
        gridX: dashboardWidgets.gridX,
        gridY: dashboardWidgets.gridY,
        gridW: dashboardWidgets.gridW,
        gridH: dashboardWidgets.gridH,
        config: dashboardWidgets.config,
      })
      .from(dashboardWidgets)
      .where(
        and(
          eq(dashboardWidgets.dashboardId, dashboardId),
          eq(dashboardWidgets.organizationId, organizationId),
          eq(dashboardWidgets.widgetType, "value_tile"),
        ),
      )
      .orderBy(asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));
    const sources = await resolveWidgetSources(this.fleetDb, organizationId, rows.map((row) => row.id));
    return stripPlan(
      rows.map((row) => ({
        key: row.id,
        title: row.title,
        gridX: row.gridX,
        gridY: row.gridY,
        gridW: row.gridW,
        gridH: row.gridH,
        config: row.config,
        sources: sources
          .filter((source) => source.widgetId === row.id)
          .map((source) => ({ id: source.id, catalogKey: source.catalogKey, params: source.params, sortOrder: source.sortOrder })),
      })),
    );
  }

  private async readOrganization(organizationId: string, notFound: string): Promise<void> {
    const [row] = await this.fleetDb
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!row) {
      throw new NotFoundException(notFound);
    }
  }

  private async readTemplate(templateId: string, organizationId: string): Promise<TemplateRow> {
    const [row] = await this.fleetDb
      .select()
      .from(dashboardTemplates)
      .where(and(eq(dashboardTemplates.id, templateId), eq(dashboardTemplates.organizationId, organizationId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Template not found for this organization");
    }
    return row;
  }

  /** The organization's newest published `organization` template, by `published_at`. */
  private async newestPublishedTemplate(organizationId: string): Promise<OrganizationTemplate> {
    const [row] = await this.fleetDb
      .select()
      .from(dashboardTemplates)
      .where(
        and(
          eq(dashboardTemplates.organizationId, organizationId),
          eq(dashboardTemplates.target, "organization"),
          eq(dashboardTemplates.status, "published"),
        ),
      )
      .orderBy(sql`${dashboardTemplates.publishedAt} DESC NULLS LAST`, desc(dashboardTemplates.version))
      .limit(1);
    if (!row) {
      throw new ConflictException(NO_ORGANIZATION_TEMPLATE_MESSAGE);
    }
    return this.checkedTemplate(row);
  }

  /** Only a published `organization` template with at least one widget copies. */
  private checkedTemplate(row: TemplateRow): OrganizationTemplate {
    if (row.status !== "published") {
      throw new ConflictException(`Only a published template can be instantiated; this one is ${row.status}`);
    }
    if (row.target !== "organization") {
      throw new BadRequestException(TEMPLATE_TARGET_BODY_MESSAGE);
    }
    const content = parseStoredContract(
      sectionTemplateContentSchema,
      row.content,
      "organization_layout.read_template.content",
    );
    if (content.widgets.length === 0) {
      throw new BadRequestException("This template has no widgets to instantiate");
    }
    return {
      id: row.id,
      code: row.code,
      version: row.version,
      name: row.name,
      widgets: content.widgets,
      stockVersion: row.stockVersion ?? null,
    };
  }

  /** `updated_by` takes an id read back from `bms.users` (the `SiteLayoutService` rule). */
  private async provisionedUserId(userId: string): Promise<string | null> {
    const [row] = await this.fleetDb.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.id ?? null;
  }
}

/**
 * Whether the view row's dashboard is this organization's organization-wide dashboard — the
 * predicate `pointedCopy` reads with, as SQL over `organization_control_room_views`, so Make's
 * "live layout" is the layout the read draws. A NULL `dashboard_id` matches no dashboard: `false`.
 */
function qualifyingCopy(organizationId: string): SQL<boolean> {
  return sql<boolean>`exists (select 1 from ${dashboards} where ${and(
    eq(dashboards.id, organizationControlRoomViews.dashboardId),
    eq(dashboards.organizationId, organizationId),
    isNull(dashboards.locationId),
    isNull(dashboards.assetGroupId),
    isNull(dashboards.assetId),
  )})`;
}

/** One tile before its values: the DTO's fields, and its sources with their binding ids. */
type PlannedTile = {
  readonly tile: Omit<OrganizationStripTileDto, "sources">;
  readonly sourceIds: readonly { id: string; catalogKey: MetricCatalogKey; sortOrder: number }[];
};

type StripPlan = { readonly tiles: readonly PlannedTile[]; readonly bindings: CatalogBindings };

type TileInput = {
  key: string;
  title: string | null;
  gridX: number;
  gridY: number;
  gridW: number;
  gridH: number;
  config: unknown;
  sources: readonly { id: string; catalogKey: string; params: unknown; sortOrder: number }[];
};

/**
 * The tiles and the bindings to resolve, from either source of tiles. A stored config that no
 * longer parses as a value tile's draws the tile with no config rather than failing the strip.
 */
function stripPlan(inputs: readonly TileInput[]): StripPlan {
  const tiles = inputs.map((input) => {
    const config = valueTileConfigSchema.safeParse(input.config);
    return {
      tile: {
        key: input.key,
        title: input.title,
        gridX: input.gridX,
        gridY: input.gridY,
        gridW: input.gridW,
        gridH: input.gridH,
        config: config.success ? config.data : {},
      },
      sourceIds: [...input.sources]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ id, catalogKey, sortOrder }) => ({ id, catalogKey: catalogKey as MetricCatalogKey, sortOrder })),
    };
  });
  return {
    tiles,
    bindings: {
      widgets: inputs.map((input) => ({ id: input.key, tabGroupId: null, widgetType: "value_tile", config: input.config })),
      sources: inputs.flatMap((input) =>
        input.sources.map((source) => ({ id: source.id, widgetId: input.key, catalogKey: source.catalogKey, params: source.params })),
      ),
      scope: ORGANIZATION_SCOPE,
      capLocationId: null,
    },
  };
}

/** The stock strip (decision 3): `organization-standard`'s tiles, keyed `stock:<widget key>`. */
function stockTiles(): StripPlan {
  return stripPlan(
    ORGANIZATION_STANDARD_TEMPLATE.content.widgets.map((widget) => ({
      key: widget.key,
      title: widget.title,
      gridX: widget.gridX,
      gridY: widget.gridY,
      gridW: widget.gridW,
      gridH: widget.gridH,
      config: widget.config,
      sources: widget.sources.map((source, index) => ({
        id: `stock:${widget.key}:${index}`,
        catalogKey: source.catalogKey,
        params: source.params,
        sortOrder: source.sortOrder ?? index,
      })),
    })),
  );
}
