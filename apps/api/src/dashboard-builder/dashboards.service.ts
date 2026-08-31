import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { dashboards, dashboardWidgetPoints, dashboardWidgetSources, dashboardWidgets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  DashboardDto,
  DashboardSummaryDto,
  DashboardWidgetDto,
  DashboardWidgetSourceDto,
  JwtPayload,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { withOrganizationReadScope } from "../database/tenant-read-scope";
import { assertBoundPointsInOrganization, resolveBoundPoints, type ResolvedBoundPoint } from "./dashboard-point-scope";
import { resolveWidgetSources, type ResolvedWidgetSource } from "./dashboard-source-scope";
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
 *
 * **One cast, not two (found in review).** `merged as unknown as DashboardWidgetDto` defeats the
 * compiler entirely — going through `unknown` accepts any shape at all, on the one mapper that
 * builds a response DTO. `merged as DashboardWidgetDto` alone still typechecks: TypeScript's
 * "insufficient overlap" check only refuses a direct cast between structurally unrelated types,
 * and `merged`'s inferred shape already carries every field of the target intersection under
 * the same names — the discriminant `widgetType` just is not narrowed to one arm's literal
 * (impossible statically here; it is a runtime value from `row`), which is exactly the residual
 * risk this comment records rather than a stronger cast hides.
 */
export function mapDashboardWidget(
  row: WidgetRow,
  points: readonly ResolvedBoundPoint[],
  sources: readonly DashboardWidgetSourceDto[] = [],
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
    // `F3.35` Stage C. Defaulted to `[]` rather than left out, because the cast below is what
    // makes an omission compile: `dashboardWidgetIdentitySchema` gained a required `sources`
    // array, `apps/api` never parses its own response, and `checkResponse` in `apps/web` throws
    // in dev and test on every dashboard read. So a missing key here is not a type error, not
    // an API error, and not visible until a browser opens a dashboard. The default keeps the
    // emitter true to the contract at every commit; Unit 3 passes the real rows.
    sources: sources.map((source) => ({
      id: source.id,
      catalogKey: source.catalogKey,
      params: source.params,
      sortOrder: source.sortOrder,
    })),
    widgetType: row.widgetType,
    config: row.config,
  };
  return merged as DashboardWidgetDto;
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
  /** `F3.35` Stage C. In the diff for the same reason `points` is: a widget whose ONLY change
   * is its catalog binding must land in `updates`, not in `unchangedIds`. */
  readonly sources: readonly { catalogKey: string; params: unknown; sortOrder: number }[];
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

function sourceSortKey(a: { catalogKey: string }, b: { catalogKey: string }): number {
  return a.catalogKey.localeCompare(b.catalogKey);
}

/**
 * `params`, serialised with its keys sorted.
 *
 * **Not `JSON.stringify` directly, and the difference is not pedantry.** The stored side comes
 * back from `jsonb`, which normalises key order (by length, then bytewise); the submitted side
 * is a request body in the author's own order. So `{"b":1,"a":2}` saved and re-submitted
 * unchanged would serialise two different ways, the diff would call it a change, and every save
 * of an untouched dashboard would rewrite every widget carrying parameters.
 *
 * `config` above is compared with a bare `JSON.stringify` and has the same exposure. It is not
 * changed here — that is `F3.1b`'s field and a behaviour change to it belongs with a test that
 * demonstrates the symptom — but do not copy that line for a new field.
 *
 * A flat sort is exact for this value: `params` is
 * `Record<string, string | number | boolean>`, so there is no nested object whose keys could
 * also be reordered.
 */
function stableParams(params: unknown): string {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return JSON.stringify(params ?? null);
  }
  const entries = Object.entries(params as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(entries);
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
  const pointsEqual = storedPoints.every(
    (point, index) =>
      point.pointId === submittedPoints[index]?.pointId &&
      point.role === submittedPoints[index]?.role &&
      point.sortOrder === submittedPoints[index]?.sortOrder,
  );
  if (!pointsEqual) return false;

  // `F3.35` Stage C. Without this block a widget whose ONLY change is its catalog binding
  // compares equal, lands in `unchangedIds`, and `putWidgets` writes nothing — the PUT answers
  // 200 carrying the old binding, and the author's rebind is silently discarded. Covered in
  // `dashboards.service.spec.ts`, which was written failing before this ran.
  const storedSources = [...stored.sources].sort(sourceSortKey);
  const submittedSources = [...(submitted.sources ?? [])].sort(sourceSortKey);
  if (storedSources.length !== submittedSources.length) return false;
  return storedSources.every(
    (source, index) =>
      source.catalogKey === submittedSources[index]?.catalogKey &&
      source.sortOrder === submittedSources[index]?.sortOrder &&
      stableParams(source.params) === stableParams(submittedSources[index]?.params),
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
   *
   * **Routed by `readableOrganizationIds`, never `readableAssetIds` (found in review).**
   * `bms.dashboards` has no asset column — its only tenant key is `organization_id` — so an
   * asset-derived routing decision is the wrong basis for this table entirely, and it failed
   * in both directions: on the fleet branch (any caller whose readable assets, or lack of
   * grants, don't collapse to exactly one organization) `readableAssetIds` supplied no
   * `WHERE` filter at all, leaking every organization's dashboards; and a scoped caller whose
   * grants resolve to zero assets took the `empty` branch and lost dashboards ADR 0047
   * Amendment 2 ruling 2 says they must see. `organizationIdFilter` is the caller-side
   * isolation control the fleet branch needs — see `withOrganizationReadScope`'s own docblock.
   */
  async list(jwt: JwtPayload, organizationId?: string): Promise<{ items: DashboardSummaryDto[] }> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    return withOrganizationReadScope(
      this.tenantDb,
      this.fleetDb,
      orgIds,
      () => ({ items: [] }),
      async (tx, organizationIdFilter) => {
        const conditions = [];
        if (organizationId) {
          conditions.push(eq(dashboards.organizationId, organizationId));
        }
        if (organizationIdFilter) {
          conditions.push(inArray(dashboards.organizationId, organizationIdFilter));
        }
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
   * Reads one dashboard by `(slug, organizationId?)` — D5: on the fleet pool a global admin (or
   * any multi-organization caller) can match more than one organization's dashboard for one
   * slug, and this refuses ambiguity with a 400 rather than guessing the first (ADR 0046's
   * audience-widening failure). Routed by `readableOrganizationIds` for the same reason `list`
   * is (see its docblock) — and `organizationIdFilter` on the fleet branch is what keeps the
   * ambiguity check itself from becoming a cross-tenant existence disclosure: it now only fires
   * when two of the CALLER'S OWN visible organizations share a slug, never a foreign one.
   */
  async getBySlug(jwt: JwtPayload, slug: string, organizationId?: string): Promise<DashboardDto> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    return withOrganizationReadScope(
      this.tenantDb,
      this.fleetDb,
      orgIds,
      () => {
        throw new NotFoundException("Dashboard not found");
      },
      async (tx, organizationIdFilter) => {
        const conditions = [eq(dashboards.slug, slug)];
        if (organizationId) {
          conditions.push(eq(dashboards.organizationId, organizationId));
        }
        if (organizationIdFilter) {
          conditions.push(inArray(dashboards.organizationId, organizationIdFilter));
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

  /**
   * Creates a dashboard. Gated by both `assertOperationsWriteRole("configuration")` and
   * `canManageDashboard` (§4.7's additive pair — the controller already ran the first before
   * this method was even called; this call is the defence-in-depth copy for a caller that
   * invokes the service directly). `body`'s scope is already singular by construction —
   * `createDashboardBodySchema`'s `scopeIsSingular` refinement refused a body carrying both
   * `locationId` and `assetGroupId` before this method could ever see it.
   */
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
    }).catch((err: unknown) => {
      throw this.translateSlugConflict(err, body.slug);
    });
  }

  /**
   * Updates a dashboard. `body` is a partial PATCH; every field is merged against the STORED
   * row before any check runs, because a PATCH that sets only `locationId` cannot see whether
   * the row already carries an `assetGroupId` — the schema alone cannot enforce singularity on
   * a value it never receives. `canManageDashboard` runs TWICE — once against the row's STORED
   * scope, once against the merged `nextScope` — and BOTH run before the "both set" 400 check
   * (finding 5, review, and its own comment below): checking scope validity first would let an
   * unauthorized caller distinguish "no such id" from "exists, and its stored scope conflicts
   * with your PATCH" through a 400 rather than the uniform 404 every other refusal on this route
   * promises.
   *
   * **Why two checks, not one (review, HIGH).** A single check against `nextScope` only answers
   * "may you write to the destination" — it never asks whether this caller may touch the row AT
   * ALL. That let a `location_admin` list an organization-wide dashboard (read is
   * organization-wide by design), PATCH it with its own `locationId`, and pass: the destination
   * is theirs, so the old check passed, and an ownerless, tenant-wide row — one ADR 0047
   * Amendment 2 ruling 2 forbids that role from ever CREATING — was re-homed under one site.
   * `remove()` then permitted deleting it, because the stored scope was now theirs. The stored
   * check is evaluated FIRST, because "may you touch this row at all" precedes "may you move it
   * there" — `remove()` (below) and `putWidgets()` already authorize this way and are the
   * in-repo precedent this method was missing.
   */
  async update(jwt: JwtPayload, id: string, body: UpdateDashboardBody): Promise<DashboardDto> {
    await this.accessControl.assertOperationsWriteRole(jwt, "configuration");
    const existing = await this.fetchRowForWrite(id);

    const storedScope: DashboardScope = { locationId: existing.locationId, assetGroupId: existing.assetGroupId };
    const nextLocationId = body.locationId !== undefined ? body.locationId : existing.locationId;
    const nextAssetGroupId = body.assetGroupId !== undefined ? body.assetGroupId : existing.assetGroupId;
    const nextScope: DashboardScope = { locationId: nextLocationId, assetGroupId: nextAssetGroupId };

    // Authorization BEFORE the scope-validity check, and deliberately in this order. Same
    // message whether this dashboard belongs to another organization or does not exist —
    // rules.service.ts:753-757's precedent: a distinct 403/400 here would let a caller tell "no
    // such dashboard" apart from "exists but not yours", a cross-tenant existence oracle. Doing
    // the "both scope columns set" check FIRST would leak exactly that through a narrower door:
    // a caller who supplies only `locationId` against a FOREIGN dashboard whose stored
    // `assetGroupId` happens to be non-null would see a 400 (revealing the row exists and its
    // scope shape) before ever reaching this refusal. canManageDashboard does not itself depend
    // on the two columns being mutually exclusive, so checking it first is safe either way —
    // `resolveScopeTarget` inside it resolves this exact "both set" merged scope to `{kind:
    // "invalid"}` rather than throwing, precisely so these call sites can run before the 400
    // check below (finding 5, review — this ordering now ships with the test that would have
    // caught reverting it).
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, storedScope))) {
      throw new NotFoundException("Dashboard not found");
    }
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, nextScope))) {
      throw new NotFoundException("Dashboard not found");
    }

    if (nextLocationId !== null && nextAssetGroupId !== null) {
      // The merged row, not just this request's body — a PATCH that sets only one of the two
      // columns cannot see the other's already-stored value, so this check must run after the
      // merge or dashboards_scope_check would refuse it as a bare 500 instead.
      throw new BadRequestException(
        "at most one of locationId or assetGroupId may be set — both null is organization-wide",
      );
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
    }).catch((err: unknown) => {
      throw this.translateSlugConflict(err, body.slug ?? existing.slug);
    });
  }

  /**
   * Deletes a dashboard. Both child tables (`dashboard_widgets`, `dashboard_widget_points`) are
   * `ON DELETE CASCADE` (migration `0050`), so no manual cleanup runs here. `canManageDashboard`
   * is evaluated against the row's OWN stored scope, which is always singular by construction —
   * there is no merge to reorder against, unlike `update`.
   */
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
      // `F3.35` Stage C. Read on the SAME transaction as the points, and fed into the diff for
      // the same reason: without it a widget whose only change is its catalog binding compares
      // equal, is skipped, and the PUT answers 200 carrying the old binding.
      const storedSources =
        storedIds.length > 0 ? await resolveWidgetSources(tx, existing.organizationId, storedIds) : [];
      const sourcesByWidget = new Map<string, ResolvedWidgetSource[]>();
      for (const source of storedSources) {
        const list = sourcesByWidget.get(source.widgetId) ?? [];
        list.push(source);
        sourcesByWidget.set(source.widgetId, list);
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
        sources: (sourcesByWidget.get(widget.id) ?? []).map((source) => ({
          catalogKey: source.catalogKey,
          params: source.params,
          sortOrder: source.sortOrder,
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
        // Replaced, never edited in place — the same shape as the point bindings above, and why
        // `bms.dashboard_widget_sources` carries no `updated_at`.
        await tx.delete(dashboardWidgetSources).where(eq(dashboardWidgetSources.widgetId, widget.id));
        await this.insertSources(tx, existing.organizationId, widget.id, widget.sources);
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
        await this.insertSources(tx, existing.organizationId, row.id, widget.sources);
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

  /**
   * Turns the partial unique index violation into an answer.
   *
   * `dashboards_organization_slug_key` (migration `0050`) is what stops two dashboards sharing a
   * slug within one organization, and it fires on an ordinary authoring mistake — reusing a
   * slug, or two authors saving the same one at once. Surfacing the raw constraint name would
   * read as a bug rather than as "pick a different slug".
   *
   * `asset-templates.service.ts:805-813`'s `translateDraftConflict` is the precedent this copies
   * verbatim in shape: read the constraint off the error, translate the one name this method
   * owns, and return every other error unchanged — including a `23505` on a different
   * constraint, which must reach the caller exactly as the driver raised it.
   */
  private translateSlugConflict(err: unknown, slug: string): unknown {
    const constraint = (err as { constraint?: string } | null)?.constraint;
    if (constraint === "dashboards_organization_slug_key") {
      return new ConflictException(
        `A dashboard with slug "${slug}" already exists in this organization. Choose a different slug.`,
      );
    }
    return err;
  }

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
   * `F3.35` Stage C — the catalog bindings for one widget.
   *
   * **`organizationId` comes from the dashboard row this service already fetched, never from the
   * request.** `putWidgets` reads it off `existing`, which `canManageDashboard` has already
   * authorized. That is what makes the absence of an `assertBoundSourcesInOrganization`
   * counterpart correct rather than an oversight: the point path needs one because a submitted
   * `pointId` names a row that may belong to another tenant, and a catalog key names an entry in
   * code with no foreign row to be outside anything.
   *
   * `params` is stored as submitted, after `METRIC_CATALOG_PARAMS_WRITE` has parsed it per entry
   * — which today means it is `{}`, because no resolve service reads a parameter yet.
   */
  private async insertSources(
    tx: BmsTx,
    organizationId: string,
    widgetId: string,
    sources: readonly { catalogKey: string; params: Record<string, unknown>; sortOrder: number }[],
  ): Promise<void> {
    if (sources.length === 0) {
      return;
    }
    await tx.insert(dashboardWidgetSources).values(
      sources.map((source) => ({
        organizationId,
        widgetId,
        catalogKey: source.catalogKey,
        params: source.params,
        sortOrder: source.sortOrder,
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

    // `F3.35` Stage C. `tx` here may be a `fleetDb` transaction — `getBySlug` resolves through
    // `withOrganizationReadScope`, whose multi-organization branch runs on the fleet pool, and
    // `bms_fleet` holds BYPASSRLS. `resolveWidgetSources` carries its own organization
    // predicate for that reason; see its file docblock.
    const sources = await resolveWidgetSources(tx, effective.organizationId, widgetIds);
    const sourcesByWidget = new Map<string, ResolvedWidgetSource[]>();
    for (const source of sources) {
      const list = sourcesByWidget.get(source.widgetId) ?? [];
      list.push(source);
      sourcesByWidget.set(source.widgetId, list);
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
      widgets: widgetRows.map((widget) =>
        mapDashboardWidget(
          widget,
          pointsByWidget.get(widget.id) ?? [],
          (sourcesByWidget.get(widget.id) ?? []).map((source) => ({
            id: source.id,
            catalogKey: source.catalogKey as DashboardWidgetSourceDto["catalogKey"],
            params: source.params as DashboardWidgetSourceDto["params"],
            sortOrder: source.sortOrder,
          })),
        ),
      ),
    };
  }
}
