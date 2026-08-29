import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { dashboards, dashboardWidgetPoints, dashboardWidgets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { DashboardDto, DashboardSummaryDto, DashboardWidgetDto, JwtPayload } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import { assertBoundPointsInOrganization, resolveBoundPoints, type ResolvedBoundPoint } from "./dashboard-point-scope";
import type { CreateDashboardBody, PutDashboardWidgetsBody, UpdateDashboardBody, WidgetWriteBody } from "./dashboards.schema";

type DashboardRow = typeof dashboards.$inferSelect;
type WidgetRow = typeof dashboardWidgets.$inferSelect;

/** One scoped-write authorization target: the two nullable scope columns together. */
type DashboardScope = { readonly locationId: string | null; readonly assetGroupId: string | null };

// ---------------------------------------------------------------------------
// Pure functions — no database. Exported so dashboards.service.spec.ts covers
// them without a Nest module or a connection (§4.6).
// ---------------------------------------------------------------------------

/** Row -> DTO. Parses against `dashboardSummaryDtoSchema` in the caller's own test — this
 * function only builds the shape. */
export function mapDashboardSummary(row: DashboardRow, widgetCount: number): DashboardSummaryDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    locationId: row.locationId,
    assetGroupId: row.assetGroupId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    widgetCount,
  };
}

/**
 * Row -> DTO for one widget. `widgetType`/`config` are cast, not re-validated: the DB CHECK
 * (`dashboard_widgets_widget_type_check`) guarantees `widgetType` is one of the four values, the
 * same trust `AdminAssetPointDto`'s `sourceKind` cast already extends to `sourceKind_check`.
 */
export function mapDashboardWidget(
  row: WidgetRow,
  points: readonly ResolvedBoundPoint[],
): DashboardWidgetDto {
  const merged = {
    id: row.id,
    dashboardId: row.dashboardId,
    organizationId: row.organizationId,
    title: row.title,
    gridX: row.gridX,
    gridY: row.gridY,
    gridW: row.gridW,
    gridH: row.gridH,
    points: points.map((point) => ({
      id: point.id,
      pointId: point.pointId,
      role: point.role as "primary" | "series",
      sortOrder: point.sortOrder,
      assetId: point.assetId,
      pointKey: point.pointKey,
      unit: point.unit,
    })),
    widgetType: row.widgetType,
    config: row.config,
  };
  return merged as unknown as DashboardWidgetDto;
}

/** One stored widget's content, in the shape the diff compares against a submitted one. */
export type StoredWidgetForDiff = {
  readonly id: string;
  readonly widgetType: string;
  readonly title: string | null;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
  readonly config: unknown;
  readonly points: readonly { pointId: string; role: string; sortOrder: number }[];
};

export type WidgetSyncDiff = {
  readonly updates: readonly WidgetWriteBody[];
  readonly inserts: readonly WidgetWriteBody[];
  readonly deleteIds: readonly string[];
  readonly unchangedIds: readonly string[];
};

function pointSortKey(a: { pointId: string; role: string }, b: { pointId: string; role: string }): number {
  return a.pointId === b.pointId ? a.role.localeCompare(b.role) : a.pointId.localeCompare(b.pointId);
}

function widgetContentEqual(stored: StoredWidgetForDiff, submitted: WidgetWriteBody): boolean {
  if (stored.widgetType !== submitted.widgetType) return false;
  if ((stored.title ?? null) !== (submitted.title ?? null)) return false;
  if (
    stored.gridX !== submitted.gridX ||
    stored.gridY !== submitted.gridY ||
    stored.gridW !== submitted.gridW ||
    stored.gridH !== submitted.gridH
  ) {
    return false;
  }
  if (JSON.stringify(stored.config) !== JSON.stringify(submitted.config)) return false;

  const storedPoints = [...stored.points].sort(pointSortKey);
  const submittedPoints = [...submitted.points].sort(pointSortKey);
  if (storedPoints.length !== submittedPoints.length) return false;
  return storedPoints.every(
    (point, index) =>
      point.pointId === submittedPoints[index]?.pointId &&
      point.role === submittedPoints[index]?.role &&
      point.sortOrder === submittedPoints[index]?.sortOrder,
  );
}

/**
 * `PUT :id/widgets`'s sync diff (D2): keys on a client-supplied `id` where present so ids
 * survive a re-save. A submitted widget whose id matches a stored one AND whose content is
 * byte-identical is neither updated nor deleted — it "keeps its id" with zero writes. A stored
 * widget absent from the submitted set is deleted; a submitted widget with no id, or an id
 * matching nothing stored, is inserted.
 */
export function diffWidgets(
  existing: readonly StoredWidgetForDiff[],
  submitted: readonly WidgetWriteBody[],
): WidgetSyncDiff {
  const existingById = new Map(existing.map((widget) => [widget.id, widget]));
  const updates: WidgetWriteBody[] = [];
  const inserts: WidgetWriteBody[] = [];
  const unchangedIds: string[] = [];
  const keepIds = new Set<string>();

  for (const widget of submitted) {
    const stored = widget.id !== undefined ? existingById.get(widget.id) : undefined;
    if (stored === undefined) {
      inserts.push(widget);
      continue;
    }
    keepIds.add(stored.id);
    if (widgetContentEqual(stored, widget)) {
      unchangedIds.push(stored.id);
    } else {
      updates.push(widget);
    }
  }

  const deleteIds = existing.map((widget) => widget.id).filter((id) => !keepIds.has(id));
  return { updates, inserts, deleteIds, unchangedIds };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/**
 * `F3.1b` — dashboard read/write API (ADR 0047). Tenant-scoped by `withTenant` as the default
 * (writes) and `withReadScope` (reads); audit-stamped the way `E7.1c` established; gated by
 * both `AccessControlService.canManageDashboard` (scope) and `assertOperationsWriteRole` (ADR
 * 0017's `configuration` write class) — additive, not alternatives (§4.7).
 *
 * Constructed with `new`, not through a Nest testing module — §4.6 records a Nest module
 * cannot be instantiated under Vitest here (esbuild strips `design:paramtypes`).
 */
@Injectable()
export class DashboardsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
  ) {}

  // ---- reads ----------------------------------------------------------------

  /**
   * Lists dashboards, tenant-scoped. Open to `viewer`/`operator` — D4: this must NOT use
   * `writableOrganizationIds` (it calls `assertMasterDataRole` and would 403 a viewer).
   */
  async list(jwt: JwtPayload, organizationId?: string): Promise<{ items: DashboardSummaryDto[] }> {
    const assetIds = await this.accessControl.readableAssetIds(jwt);
    return withReadScope(
      this.tenantDb,
      this.fleetDb,
      assetIds,
      () => ({ items: [] }),
      async (tx) => {
        const conditions = organizationId ? [eq(dashboards.organizationId, organizationId)] : [];
        const rows = await tx
          .select({
            dashboard: dashboards,
            widgetCount: sql<number>`(
              SELECT COUNT(*)::int FROM ${dashboardWidgets}
               WHERE ${dashboardWidgets.dashboardId} = ${dashboards.id}
            )`,
          })
          .from(dashboards)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(asc(dashboards.slug));
        return { items: rows.map((row) => mapDashboardSummary(row.dashboard, row.widgetCount)) };
      },
    );
  }

  /**
   * Reads one dashboard by `(slug, organizationId?)` — D5: on the fleet pool a global admin can
   * match more than one organization's dashboard for one slug, and this refuses ambiguity with
   * a 400 rather than guessing the first (ADR 0046's audience-widening failure).
   */
  async getBySlug(jwt: JwtPayload, slug: string, organizationId?: string): Promise<DashboardDto> {
    const assetIds = await this.accessControl.readableAssetIds(jwt);
    return withReadScope(
      this.tenantDb,
      this.fleetDb,
      assetIds,
      () => {
        throw new NotFoundException("Dashboard not found");
      },
      async (tx) => {
        const conditions = [eq(dashboards.slug, slug)];
        if (organizationId) {
          conditions.push(eq(dashboards.organizationId, organizationId));
        }
        const rows = await tx
          .select()
          .from(dashboards)
          .where(and(...conditions));
        if (rows.length === 0) {
          throw new NotFoundException("Dashboard not found");
        }
        if (rows.length > 1) {
          throw new BadRequestException(
            "More than one dashboard matches this slug; pass organizationId to disambiguate",
          );
        }
        return this.loadFullDto(tx, (rows[0] as DashboardRow).id);
      },
    );
  }

  // ---- writes -----------------------------------------------------------------

  async create(jwt: JwtPayload, body: CreateDashboardBody): Promise<DashboardDto> {
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    const scope: DashboardScope = { locationId: body.locationId ?? null, assetGroupId: body.assetGroupId ?? null };
    if (!(await this.accessControl.canManageDashboard(jwt, body.organizationId, scope))) {
      throw new ForbiddenException("You may not create a dashboard with this scope");
    }

    // The read-back is FOLDED into this one transaction, not a second withTenant — Task 4's
    // pool-routing test asserts exactly one tenant transaction for create(), and a folded
    // read-back is invisible to countingDb (it counts only top-level .transaction), which is
    // exactly why the gate for THIS behaviour is the returned DTO, not a transaction count.
    return withTenant(this.tenantDb, body.organizationId, async (tx) => {
      const [row] = await tx
        .insert(dashboards)
        .values({
          organizationId: body.organizationId,
          slug: body.slug,
          name: body.name,
          description: body.description ?? null,
          locationId: scope.locationId,
          assetGroupId: scope.assetGroupId,
        })
        .returning();

      // E7.1c (item D): folded into this transaction so the stamped organizationId matches
      // the GUC the strict WITH CHECK demands.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.dashboard.create",
          entityType: "dashboard",
          entityId: row.id,
          organizationId: body.organizationId,
          payload: { slug: body.slug, locationId: scope.locationId, assetGroupId: scope.assetGroupId },
        },
        tx,
      );
      return this.loadFullDto(tx, row.id);
    });
  }

  async update(jwt: JwtPayload, id: string, body: UpdateDashboardBody): Promise<DashboardDto> {
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    const existing = await this.fetchRowForWrite(id);

    const nextLocationId = body.locationId !== undefined ? body.locationId : existing.locationId;
    const nextAssetGroupId = body.assetGroupId !== undefined ? body.assetGroupId : existing.assetGroupId;
    if (nextLocationId !== null && nextAssetGroupId !== null) {
      // The merged row, not just this request's body — a PATCH that sets only one of the two
      // columns cannot see the other's already-stored value, so this check must run after the
      // merge or dashboards_scope_check would refuse it as a bare 500 instead.
      throw new BadRequestException(
        "at most one of locationId or assetGroupId may be set — both null is organization-wide",
      );
    }
    const nextScope: DashboardScope = { locationId: nextLocationId, assetGroupId: nextAssetGroupId };

    // Same message whether this dashboard belongs to another organization or does not exist —
    // rules.service.ts:753-757's precedent: a distinct 403 here would let a caller tell "no such
    // dashboard" apart from "exists but not yours", a cross-tenant existence oracle.
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, nextScope))) {
      throw new NotFoundException("Dashboard not found");
    }

    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      await tx
        .update(dashboards)
        .set({
          slug: body.slug ?? existing.slug,
          name: body.name ?? existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          locationId: nextLocationId,
          assetGroupId: nextAssetGroupId,
          updatedAt: new Date(),
        })
        .where(eq(dashboards.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.dashboard.update",
          entityType: "dashboard",
          entityId: id,
          organizationId: existing.organizationId,
          payload: body,
        },
        tx,
      );

      return this.loadFullDto(tx, id);
    });
  }

  async remove(jwt: JwtPayload, id: string): Promise<void> {
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    const existing = await this.fetchRowForWrite(id);
    const scope: DashboardScope = { locationId: existing.locationId, assetGroupId: existing.assetGroupId };
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, scope))) {
      throw new NotFoundException("Dashboard not found");
    }

    await withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      // Both child tables are ON DELETE CASCADE (migration 0050) — no manual cleanup.
      await tx.delete(dashboards).where(eq(dashboards.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.dashboard.delete",
          entityType: "dashboard",
          entityId: id,
          organizationId: existing.organizationId,
        },
        tx,
      );
    });
  }

  /** `PUT :id/widgets` — D2: the whole set, written whole, one transaction. */
  async putWidgets(jwt: JwtPayload, id: string, body: PutDashboardWidgetsBody): Promise<DashboardDto> {
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    const existing = await this.fetchRowForWrite(id);
    const scope: DashboardScope = { locationId: existing.locationId, assetGroupId: existing.assetGroupId };
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, scope))) {
      throw new NotFoundException("Dashboard not found");
    }

    return withTenant(this.tenantDb, existing.organizationId, async (tx) => {
      const storedWidgets = await tx
        .select()
        .from(dashboardWidgets)
        .where(eq(dashboardWidgets.dashboardId, id));
      const storedIds = storedWidgets.map((widget) => widget.id);
      const storedPoints =
        storedIds.length > 0 ? await resolveBoundPoints(tx, existing.organizationId, storedIds) : [];
      const pointsByWidget = new Map<string, ResolvedBoundPoint[]>();
      for (const point of storedPoints) {
        const list = pointsByWidget.get(point.widgetId) ?? [];
        list.push(point);
        pointsByWidget.set(point.widgetId, list);
      }
      const forDiff: StoredWidgetForDiff[] = storedWidgets.map((widget) => ({
        id: widget.id,
        widgetType: widget.widgetType,
        title: widget.title,
        gridX: widget.gridX,
        gridY: widget.gridY,
        gridW: widget.gridW,
        gridH: widget.gridH,
        config: widget.config,
        points: (pointsByWidget.get(widget.id) ?? []).map((point) => ({
          pointId: point.pointId,
          role: point.role,
          sortOrder: point.sortOrder,
        })),
      }));

      // Task 5's guard — before any insert, and never echoes a foreign id back.
      const allPointIds = body.widgets.flatMap((widget) => widget.points.map((point) => point.pointId));
      await assertBoundPointsInOrganization(tx, existing.organizationId, allPointIds);

      const diff = diffWidgets(forDiff, body.widgets);

      if (diff.deleteIds.length > 0) {
        await tx.delete(dashboardWidgets).where(inArray(dashboardWidgets.id, [...diff.deleteIds]));
      }

      for (const widget of diff.updates) {
        if (widget.id === undefined) continue; // narrowed by diffWidgets; guard for TS
        await tx
          .update(dashboardWidgets)
          .set({
            widgetType: widget.widgetType,
            title: widget.title ?? null,
            gridX: widget.gridX,
            gridY: widget.gridY,
            gridW: widget.gridW,
            gridH: widget.gridH,
            config: widget.config,
            updatedAt: new Date(),
          })
          .where(eq(dashboardWidgets.id, widget.id));
        await tx.delete(dashboardWidgetPoints).where(eq(dashboardWidgetPoints.widgetId, widget.id));
        await this.insertPoints(tx, existing.organizationId, widget.id, widget.points);
      }

      for (const widget of diff.inserts) {
        const [row] = await tx
          .insert(dashboardWidgets)
          .values({
            organizationId: existing.organizationId,
            dashboardId: id,
            widgetType: widget.widgetType,
            title: widget.title ?? null,
            gridX: widget.gridX,
            gridY: widget.gridY,
            gridW: widget.gridW,
            gridH: widget.gridH,
            config: widget.config,
          })
          .returning();
        await this.insertPoints(tx, existing.organizationId, row.id, widget.points);
      }

      await tx.update(dashboards).set({ updatedAt: new Date() }).where(eq(dashboards.id, id));

      await this.audit.write(
        {
          actor: jwt,
          action: "master.dashboard.widgets.replace",
          entityType: "dashboard",
          entityId: id,
          organizationId: existing.organizationId,
          payload: {
            widgetCount: body.widgets.length,
            updates: diff.updates.length,
            inserts: diff.inserts.length,
            deletes: diff.deleteIds.length,
          },
        },
        tx,
      );

      return this.loadFullDto(tx, id);
    });
  }

  // ---- shared helpers -----------------------------------------------------

  private async insertPoints(
    tx: BmsTx,
    organizationId: string,
    widgetId: string,
    points: readonly { pointId: string; role: string; sortOrder: number }[],
  ): Promise<void> {
    if (points.length === 0) {
      return;
    }
    await tx.insert(dashboardWidgetPoints).values(
      points.map((point) => ({
        organizationId,
        widgetId,
        pointId: point.pointId,
        role: point.role,
        sortOrder: point.sortOrder,
      })),
    );
  }

  /**
   * The pre-write current-row read, on `fleetDb` before the org is resolved — the same
   * pre-GUC shape `assets.service.ts:189-191` uses. `canManageDashboard` (called by every
   * caller of this method) is the isolation control for the row this returns.
   */
  private async fetchRowForWrite(id: string): Promise<DashboardRow> {
    const [row] = await this.fleetDb.select().from(dashboards).where(eq(dashboards.id, id)).limit(1);
    if (!row) {
      throw new NotFoundException("Dashboard not found");
    }
    return row;
  }

  /**
   * Loads the full DTO (dashboard + widgets + resolved points) inside an open tenant `tx`,
   * re-reading the dashboard row itself so `updatedAt` and every other column reflect whatever
   * `tx` just wrote — the "gate on the returned DTO, not a transaction count" rule Task 4 owes
   * (a folded read-back is invisible to `countingDb`, which counts only top-level
   * `.transaction`; see `dashboards.service.rls.integration.spec.ts`).
   */
  private async loadFullDto(tx: BmsTx, dashboardId: string): Promise<DashboardDto> {
    const [effective] = await tx.select().from(dashboards).where(eq(dashboards.id, dashboardId)).limit(1);
    if (!effective) {
      throw new NotFoundException("Dashboard not found");
    }

    const widgetRows = await tx
      .select()
      .from(dashboardWidgets)
      .where(eq(dashboardWidgets.dashboardId, dashboardId))
      .orderBy(asc(dashboardWidgets.gridY), asc(dashboardWidgets.gridX));
    const widgetIds = widgetRows.map((widget) => widget.id);
    const points = await resolveBoundPoints(tx, effective.organizationId, widgetIds);
    const pointsByWidget = new Map<string, ResolvedBoundPoint[]>();
    for (const point of points) {
      const list = pointsByWidget.get(point.widgetId) ?? [];
      list.push(point);
      pointsByWidget.set(point.widgetId, list);
    }

    return {
      id: effective.id,
      organizationId: effective.organizationId,
      slug: effective.slug,
      name: effective.name,
      description: effective.description,
      locationId: effective.locationId,
      assetGroupId: effective.assetGroupId,
      createdAt: effective.createdAt.toISOString(),
      updatedAt: effective.updatedAt.toISOString(),
      widgets: widgetRows.map((widget) => mapDashboardWidget(widget, pointsByWidget.get(widget.id) ?? [])),
    };
  }
}
