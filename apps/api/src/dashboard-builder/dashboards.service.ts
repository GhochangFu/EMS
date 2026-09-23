import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  assets,
  dashboards,
  dashboardTemplates,
  dashboardWidgetPoints,
  dashboardWidgetSources,
  dashboardWidgets,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  DashboardDto,
  DashboardSummaryDto,
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
import { SCOPE_REFUSAL_MESSAGE } from "./dashboards.schema";
import {
  assertSourceParamsBalanceRolesActive,
  assertSourceParamsPointKeysActive,
} from "./source-params-point-keys";
import type { CreateDashboardBody, PutDashboardWidgetsBody, UpdateDashboardBody } from "./dashboards.schema";

import {
  diffWidgets,
  mapDashboardSummary,
  mapDashboardWidget,
  type DashboardRow,
  type StoredWidgetForDiff,
} from "./dashboards.pure";

// Re-exported so `dashboards.service.spec.ts` and any other importer of the pure helpers keep
// compiling after the byte-identical move to `dashboards.pure.ts` (§4.5, `E4.2`).
export {
  diffWidgets,
  mapDashboardSummary,
  mapDashboardWidget,
  type StoredWidgetForDiff,
  type WidgetSyncDiff,
} from "./dashboards.pure";

/**
 * One scoped-write authorization target: the three nullable scope columns together.
 *
 * `assetId` is `F3.2` / ADR 0067 decision 1's third axis, and it is a REQUIRED field rather
 * than an optional one on purpose: an optional parameter at an adapter is invisible — every
 * call site keeps compiling while the new arm is never reached, so the feature ships inert.
 */
type DashboardScope = {
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
};

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
  async list(
    jwt: JwtPayload,
    organizationId?: string,
    assetId?: string,
    section?: string,
  ): Promise<{ items: DashboardSummaryDto[] }> {
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
        // `F3.31` / ADR 0068 decision 4 — ANDed beside the organization conditions, so it narrows
        // within the read scope and cannot widen it: an out-of-scope id answers `[]`, never 403.
        if (assetId) {
          conditions.push(eq(dashboards.assetId, assetId));
        }
        /**
         * `E4.2` / ADR 0072 decision 1 — the dashboards of one section.
         *
         * **A LEFT join with the predicate in `conditions`, never an
         * `innerJoin`.** A hand-built dashboard has `template_id IS NULL`, so an
         * unconditional inner join would silently drop every one of them from
         * the unfiltered list — and the filtered case would stay perfectly
         * correct while it happened. With the join left and the section
         * predicate ANDed beside the organization conditions, the filtered read
         * behaves as an inner join and the unfiltered read is untouched. Same
         * shape, and the same reason, as the `assets` join below.
         *
         * Narrows within the read scope and cannot widen it, exactly as
         * `assetId` does: an unknown code answers `[]`, never a 403.
         *
         * `eq(dashboardTemplates.organizationId, dashboards.organizationId)` is
         * part of the JOIN, not merely of the tenant policy. On the FLEET branch
         * this runs as `bms_fleet` (`BYPASSRLS`), where nothing else would stop
         * a mis-stamped `template_id` from matching another organization's
         * template and admitting the row under that organization's section.
         */
        if (section) {
          conditions.push(eq(dashboardTemplates.section, section));
        }
        // `F3.2` / ADR 0067 §"Gate questions" Q4 — the badge reads `Asset · <code>`, and the
        // summary DTO has no code of its own, so the code is joined here.
        //
        // **A LEFT join, never an inner one.** Every organization-wide, location-scoped and
        // group-scoped dashboard has `asset_id IS NULL`; an inner join would silently drop
        // every row this list exists to return. A null `assetCode` is the contract's own
        // "this dashboard is not asset-scoped" value.
        //
        // The tenant branch runs as `bms_tenant` under FORCE RLS, which holds SELECT on
        // `bms.assets` with the same `app.current_organization` GUC already set — verified
        // against the dev database rather than assumed, because a missing grant here would
        // 500 `GET /dashboards` for every scoped caller, including the org-wide rows.
        const rows = await tx
          .select({
            dashboard: dashboards,
            assetCode: assets.code,
            widgetCount: sql<number>`(
              SELECT COUNT(*)::int FROM ${dashboardWidgets}
               WHERE ${dashboardWidgets.dashboardId} = ${dashboards.id}
            )`,
          })
          .from(dashboards)
          .leftJoin(
            assets,
            // The organization predicate is part of the JOIN, not merely of the tenant policy.
            // On the FLEET branch this query runs as `bms_fleet` (`BYPASSRLS`), so nothing else
            // stops a dashboard from reporting another organization's asset code once an
            // `asset_id` has been mis-stamped: the join would resolve it and the badge would
            // read it out. On the tenant branch it is redundant with RLS and costs nothing.
            and(eq(assets.id, dashboards.assetId), eq(assets.organizationId, dashboards.organizationId)),
          )
          // `E4.2` — see the `section` condition above for why this is LEFT and
          // why the organization predicate is in the join.
          .leftJoin(
            dashboardTemplates,
            and(
              eq(dashboardTemplates.id, dashboards.templateId),
              eq(dashboardTemplates.organizationId, dashboards.organizationId),
            ),
          )
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(asc(dashboards.slug));
        return {
          items: rows.map((row) =>
            mapDashboardSummary(row.dashboard, row.widgetCount, row.assetCode),
          ),
        };
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
    const scope: DashboardScope = {
      locationId: body.locationId ?? null,
      assetGroupId: body.assetGroupId ?? null,
      assetId: body.assetId ?? null,
    };
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
          // `F3.2` — the scope axis only. `asset_template_id` stays NULL on every hand-built
          // dashboard: it is the instantiation stamp, and
          // `dashboards_asset_stamp_check` (migration 0073) is what keeps a stamp from
          // existing without an asset.
          assetId: scope.assetId,
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
          payload: {
            slug: body.slug,
            locationId: scope.locationId,
            assetGroupId: scope.assetGroupId,
            assetId: scope.assetId,
          },
        },
        tx,
      );
      return this.loadFullDto(tx, row.id);
    }).catch((err: unknown) => {
      throw this.translateWriteError(err, body.slug, scope);
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

    const storedScope: DashboardScope = {
      locationId: existing.locationId,
      assetGroupId: existing.assetGroupId,
      assetId: existing.assetId,
    };
    const nextLocationId = body.locationId !== undefined ? body.locationId : existing.locationId;
    const nextAssetGroupId = body.assetGroupId !== undefined ? body.assetGroupId : existing.assetGroupId;
    const nextAssetId = body.assetId !== undefined ? body.assetId : existing.assetId;
    const nextScope: DashboardScope = {
      locationId: nextLocationId,
      assetGroupId: nextAssetGroupId,
      assetId: nextAssetId,
    };

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

    // The merged row, not just this request's body — a PATCH that sets only one of the three
    // columns cannot see the others' already-stored values, so this check must run after the
    // merge or dashboards_scope_check would refuse it as a bare 500 instead.
    //
    // Counted, not written pairwise: `F3.2` made this three axes, and the three pairwise
    // comparisons a reader is tempted to write here are exactly what migration 0073 replaced
    // in SQL with `(location_id IS NOT NULL)::int + … <= 1`. The sentence is IMPORTED from
    // `dashboards.schema.ts` rather than restated — it used to be restated verbatim, and one
    // rule stated twice is one reword away from two different 400s.
    if ([nextLocationId, nextAssetGroupId, nextAssetId].filter((value) => value !== null).length > 1) {
      throw new BadRequestException(SCOPE_REFUSAL_MESSAGE);
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
          assetId: nextAssetId,
          // Review (security Medium / migration High) — the stamp FOLLOWS the asset, in the
          // same UPDATE. `asset_template_id` says "instantiated from that template version for
          // THAT asset" (ADR 0067 decision 3). Clearing `assetId` while leaving it behind hits
          // `dashboards_asset_stamp_check` and reached the caller as a 500; moving the row to
          // another asset kept a stamp the database still accepts and the backfill's skip
          // query still believes — forged provenance, and an asset that never gets its
          // defaults. Nothing re-stamps: only the instantiator writes this column.
          assetTemplateId: nextAssetId === existing.assetId ? existing.assetTemplateId : null,
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
      throw this.translateWriteError(err, body.slug ?? existing.slug, nextScope);
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
    const scope: DashboardScope = {
      locationId: existing.locationId,
      assetGroupId: existing.assetGroupId,
      assetId: existing.assetId,
    };
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
    const scope: DashboardScope = {
      locationId: existing.locationId,
      assetGroupId: existing.assetGroupId,
      assetId: existing.assetId,
    };
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

      // `E4.2` U3 — every `params.pointKey` the submitted sources name that the dashboard does
      // not already store must be an active catalog code (ADR 0072 decision 2). Once per request
      // over ALL widgets, before any write. `create` has no widgets, so this is the one dashboard
      // write path that carries a source. Post-merge sweep M1 — the subtraction is the `C1` rule
      // of `AssetsService.update`: the builder re-sends stored params verbatim, so a role or key
      // retired since would otherwise 400 every save of the dashboard. The stored set is this
      // transaction's own read (review C1), so it is the set the diff below writes against; the
      // vocabulary lookups stay on the fleet pool, as the vocabularies are global tables.
      const submittedSources = body.widgets.flatMap((widget) => widget.sources);
      await assertSourceParamsPointKeysActive(this.fleetDb, submittedSources, storedSources);
      // `E4.3` — and every `params.balanceRole` a live `bms.water_balance_roles` code (ADR 0073
      // decision 2), on the same terms.
      await assertSourceParamsBalanceRolesActive(this.fleetDb, submittedSources, storedSources);

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
    }).catch((err: unknown) => {
      throw this.translateWriteError(err, existing.slug, scope);
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
  /**
   * The one error translation every write on this service goes through: the slug 409 first,
   * then the scope refusals below, then the driver's error unchanged.
   *
   * **One function, not two chained `.catch`es.** A second handler only ever sees what the
   * first re-threw, so the order of two catches decides which translation is reachable — and
   * the losing one is silently dead.
   *
   * Two states reach a caller as a 500 without this (review, security Low):
   *
   * - `42501` — `tenant_isolation`'s `WITH CHECK` on `bms.dashboards`, which migration `0073`
   *   re-created to check the `asset_id` and `asset_template_id` parents as well. A scope id
   *   from another organization is refused there, never by the foreign key (`0050`'s header:
   *   `WITH CHECK` runs before the FK's `AFTER` trigger).
   * - `23514` on `dashboards_scope_check` / `dashboards_asset_stamp_check` — the two CHECKs the
   *   service's own guards are supposed to reach first. A 400 here is the backstop for a state
   *   a guard missed, not a replacement for the guard.
   *
   * The field named is the scope axis this write actually set, taken from the merged scope the
   * caller already computed — the error itself carries no column. `putWidgets` passes the
   * STORED scope because it writes no scope column of its own, and naming a field from a widget
   * body would misattribute the refusal.
   *
   * **What protects `putWidgets` is not this translation.** A foreign `pointId` in a widget body
   * is refused by `assertBoundPointsInOrganization`, which runs inside the same transaction
   * **before any insert** and raises a 400 counting how many bindings were outside the
   * organization without echoing an id back (§9.6). By the time a `42501` could fire here, that
   * guard has already returned; this method is the backstop for a state the guard does not
   * cover, not the control.
   */
  private translateWriteError(err: unknown, slug: string, scope: DashboardScope): unknown {
    const translatedSlug = this.translateSlugConflict(err, slug);
    if (translatedSlug !== err) {
      return translatedSlug;
    }
    const code = (err as { code?: string } | null)?.code;
    const constraint = (err as { constraint?: string } | null)?.constraint;
    // FIRST, and independent of the scope axes: this CHECK is about `asset_template_id`, a
    // column no request body carries and `scope` does not either. Naming a scope axis here
    // would attribute the refusal to a field that is not the offending one — the item-1
    // mutation run produced exactly that sentence before this branch was split out.
    if (code === "23514" && constraint === "dashboards_asset_stamp_check") {
      return new BadRequestException(
        "This dashboard still carries an asset-template stamp, which describes nothing once it " +
          "names no asset. The stamp is cleared together with the asset scope.",
      );
    }
    const field =
      scope.assetId !== null
        ? "assetId"
        : scope.assetGroupId !== null
          ? "assetGroupId"
          : scope.locationId !== null
            ? "locationId"
            : null;
    if (field === null) {
      return err;
    }
    if (code === "42501") {
      return new BadRequestException(
        `The ${field} you supplied does not belong to this dashboard's organization — the ` +
          "write was refused by this table's row-level security policy.",
      );
    }
    if (code === "23514" && constraint === "dashboards_scope_check") {
      return new BadRequestException(
        `The ${field} you supplied leaves this dashboard in a scope the database refuses: ` +
          SCOPE_REFUSAL_MESSAGE,
      );
    }
    return err;
  }

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
   * — `{}` for the five Stage C entries, `{ pointKey, aggregate }` plus an optional
   * `balanceRole` for the two sustainability roll-ups (`E4.2` / ADR 0072 decision 2, `E4.3` /
   * ADR 0073 decision 2), which `MetricCatalogService` reads back.
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
      assetId: effective.assetId,
      assetTemplateId: effective.assetTemplateId,
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
