import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";

import {
  assets,
  automationRules,
  locations,
  maintenanceSchedules,
  maintenanceWindows,
  maintenanceWindowTargets,
  maintenanceTaskTemplates,
  users,
  workOrders,
} from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  CloseMaintenanceWindowBody,
  CreateMaintenanceWindowBody,
  ExtendMaintenanceWindowBody,
  JwtPayload,
  MaintenanceWindowItem,
  MaintenanceWindowState,
  MaintenanceWindowTarget,
  MaintenanceWindowsResponse,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { resolveActorId } from "../auth/identity-resolver";
import { expandLocationSubtrees, locationAncestorChains } from "../auth/location-tree";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { withOrganizationReadScope } from "../database/tenant-read-scope";
import { validateExtension, validateWindowPeriod } from "./maintenance-window-period";
import {
  everyTargetInScope,
  isUnrestricted,
  resolveAssetFilter,
  resolveLocationFilter,
  targetInScope,
  targetVisibleTo,
  visibleLocationIds,
  windowClockIs,
  windowCoversAsset,
  windowInState,
  windowStateSql,
  windowTouchesLocation,
  windowVisibleTo,
  type AssetFilter,
  type LocationFilter,
  type MaintenanceWindowReadScope,
  type ResolvedTarget,
} from "./maintenance-window-scope";
import type { MaintenanceWindowListQuery } from "./maintenance-windows.schema";

/** One text for a target that does not exist and one outside the scope: no existence leak (plan U3). */
export const TARGET_REFUSED = "A target does not exist or is outside your access scope";
export const TARGETS_SPAN_ORGANIZATIONS = "Every target of a maintenance window must belong to one organization";
export const WORK_ORDER_REFUSED = "The work order does not exist in the window's organization or is outside your access scope";
export const SCHEDULE_REFUSED = "The maintenance schedule does not exist in the window's organization or is outside your access scope";
export const WINDOW_NOT_FOUND = "Maintenance window not found or outside your access scope";
export const NOT_PROVISIONED = "This account is not provisioned, so it cannot change maintenance windows";

const ENTITY_TYPE = "maintenance_window";

type Actor = Pick<JwtPayload, "sub" | "email">;

type WindowRow = {
  id: string;
  organizationId: string;
  reason: string;
  startsAt: Date;
  endsAt: Date;
  endedAt: Date | null;
  state: MaintenanceWindowState;
  createdBy: string;
  endedBy: string | null;
  workOrderId: string | null;
  workOrderReference: string | null;
  maintenanceScheduleId: string | null;
  maintenanceScheduleTitle: string | null;
};

/** The request's filters, as `assetIds` (D16) narrows by them too. */
type ItemFilters = { readonly asset?: AssetFilter; readonly location?: LocationFilter };

/**
 * `F4.359` U3 (ADR 0131 decisions 1, 2, 13, 14, 17; plan D1, D2, D3, D15, D16)
 * — the maintenance-window list and its four writes.
 *
 * The routes write **no alarm row** (D4): the raiser and the sweep stamp. Every
 * write runs in one `withTenant` transaction with its audit row
 * (`MasterDataAuditService.write`, the `alarms.service.ts` acknowledge model), so
 * the copilot `via` mark needs no later change (D14).
 */
@Injectable()
export class MaintenanceWindowsService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * The windows the caller reads, newest start first. A single readable
   * organization reads under `withTenant`.
   *
   * §4.3 fleet read, by name: the other branch of `withOrganizationReadScope`
   * — the unrestricted admin's fleet-wide view and a caller who reads more than
   * one organization. One tenant GUC cannot show windows of two organizations;
   * the branch ANDs the caller's own organization list onto every row, and the
   * visibility predicate below still binds a scoped caller to its targets.
   */
  async list(query: MaintenanceWindowListQuery, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowsResponse> {
    const empty = (): MaintenanceWindowsResponse => ({ items: [] });
    return withOrganizationReadScope(this.db, this.fleetDb, nullableCopy(scope.organizationIds), empty, async (tx, organizationFilter) => {
      const where: SQL[] = [];
      if (organizationFilter !== null) where.push(inArray(maintenanceWindows.organizationId, organizationFilter));
      const visible = await visibleLocationIds(tx, scope);
      if (visible !== null) where.push(windowVisibleTo(scope.assetIds ?? [], visible));
      if (query.organizationId !== undefined) where.push(eq(maintenanceWindows.organizationId, query.organizationId));
      if (query.state !== undefined) where.push(windowInState(query.state));
      const filters: { asset?: AssetFilter; location?: LocationFilter } = {};
      if (query.assetId !== undefined) {
        const asset = await resolveAssetFilter(tx, scope, query.assetId);
        if (asset === null) return empty();
        filters.asset = asset;
        where.push(windowCoversAsset(asset));
      }
      if (query.locationId !== undefined) {
        const location = await resolveLocationFilter(tx, scope, query.locationId);
        if (location === null) return empty();
        filters.location = location;
        where.push(windowTouchesLocation(location));
      }
      const rows = await this.selectRows(tx, and(...where), query.limit);
      return { items: await this.toItems(tx, rows, scope, visible, filters) };
    });
  }

  /** `POST /maintenance-windows` — the organization is the targets' (D1); the period is checked here (D3). */
  async create(actor: Actor, body: CreateMaintenanceWindowBody, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowItem> {
    const targets = await this.resolveTargets(body.targets);
    if (targets === null || !targets.every((target) => targetInScope(target, scope))) {
      throw new BadRequestException(TARGET_REFUSED);
    }
    const organizationIds = [...new Set(targets.map((target) => target.organizationId))];
    const organizationId = organizationIds[0];
    if (organizationIds.length !== 1 || organizationId === undefined) {
      throw new BadRequestException(TARGETS_SPAN_ORGANIZATIONS);
    }
    const createdBy = await this.requireActorId(actor);

    return withTenant(this.db, organizationId, async (tx) => {
      // D2: the period is read against the database clock, once, and an absent start is that `now()`.
      const now = await databaseNow(tx);
      const startsAt = body.startsAt === undefined ? now : new Date(body.startsAt);
      const endsAt = new Date(body.endsAt);
      const periodError = validateWindowPeriod({ now, startsAt, endsAt });
      if (periodError !== null) throw new BadRequestException(periodError);
      await this.assertLinksInScope(tx, organizationId, body, scope);
      const [window] = await tx
        .insert(maintenanceWindows)
        .values({
          organizationId,
          reason: body.reason,
          startsAt,
          endsAt,
          createdBy,
          workOrderId: body.workOrderId ?? null,
          maintenanceScheduleId: body.maintenanceScheduleId ?? null,
        })
        .returning({ id: maintenanceWindows.id });
      if (!window) throw new Error("F4.359: the window insert returned no row");
      await tx.insert(maintenanceWindowTargets).values(
        targets.map((target) => ({
          windowId: window.id,
          organizationId,
          assetId: target.kind === "asset" ? target.id : null,
          locationId: target.kind === "location" ? target.id : null,
          ruleId: target.kind === "rule" ? target.id : null,
        })),
      );
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "maintenance_window_create",
          entityType: ENTITY_TYPE,
          entityId: window.id,
          reason: body.reason,
          payload: {
            windowId: window.id,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            targets: targets.map((target) => ({ kind: target.kind, id: target.id })),
            workOrderId: body.workOrderId ?? null,
            maintenanceScheduleId: body.maintenanceScheduleId ?? null,
          },
        },
        tx,
      );
      return this.itemById(tx, window.id, scope);
    });
  }

  /** `POST /maintenance-windows/:id/extend` — an active window only; the new end is later and within now + 7 d. */
  async extend(actor: Actor, id: string, body: ExtendMaintenanceWindowBody, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowItem> {
    const window = await this.loadForWrite(id, scope);
    const endsAt = new Date(body.endsAt);
    await this.requireActorId(actor);

    return withTenant(this.db, window.organizationId, async (tx) => {
      // The current end is read under the row lock the `UPDATE` keeps, so the audit's
      // `previousEndsAt` is the end this extension replaced, not one a concurrent write moved.
      const [locked] = await tx
        .select({ endsAt: maintenanceWindows.endsAt })
        .from(maintenanceWindows)
        .where(eq(maintenanceWindows.id, id))
        .for("update");
      if (!locked) throw new NotFoundException(WINDOW_NOT_FOUND);
      const periodError = validateExtension({ now: await databaseNow(tx), endsAt, currentEndsAt: locked.endsAt });
      if (periodError !== null) throw new BadRequestException(periodError);
      const updated = await tx
        .update(maintenanceWindows)
        .set({ endsAt, updatedAt: sql`now()` })
        .where(and(eq(maintenanceWindows.id, id), isNull(maintenanceWindows.endedAt), windowClockIs("active"), lt(maintenanceWindows.endsAt, endsAt)))
        .returning({ id: maintenanceWindows.id });
      if (updated.length === 0) throw new ConflictException("Only an active maintenance window can be extended");
      await this.audit.write(
        {
          actor,
          organizationId: window.organizationId,
          action: "maintenance_window_extend",
          entityType: ENTITY_TYPE,
          entityId: id,
          reason: body.reason,
          payload: { windowId: id, previousEndsAt: locked.endsAt.toISOString(), endsAt: endsAt.toISOString() },
        },
        tx,
      );
      return this.itemById(tx, id, scope);
    });
  }

  /** `POST /maintenance-windows/:id/end` — an active window ends now. */
  end(actor: Actor, id: string, body: CloseMaintenanceWindowBody, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowItem> {
    return this.close(actor, id, body, scope, "end");
  }

  /** `POST /maintenance-windows/:id/cancel` — a future window never starts. */
  cancel(actor: Actor, id: string, body: CloseMaintenanceWindowBody, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowItem> {
    return this.close(actor, id, body, scope, "cancel");
  }

  /** End and cancel both write `ended_at`/`ended_by` (D2); the guard is the state each may leave. */
  private async close(
    actor: Actor,
    id: string,
    body: CloseMaintenanceWindowBody,
    scope: MaintenanceWindowReadScope,
    verb: "end" | "cancel",
  ): Promise<MaintenanceWindowItem> {
    const window = await this.loadForWrite(id, scope);
    const endedBy = await this.requireActorId(actor);
    const from = verb === "end" ? "active" : "future";

    return withTenant(this.db, window.organizationId, async (tx) => {
      const updated = await tx
        .update(maintenanceWindows)
        .set({ endedAt: sql`now()`, endedBy, updatedAt: sql`now()` })
        .where(and(eq(maintenanceWindows.id, id), isNull(maintenanceWindows.endedAt), windowClockIs(from)))
        .returning({ id: maintenanceWindows.id });
      if (updated.length === 0) {
        throw new ConflictException(
          verb === "end" ? "Only an active maintenance window can be ended" : "Only a future maintenance window can be cancelled",
        );
      }
      await this.audit.write(
        {
          actor,
          organizationId: window.organizationId,
          action: `maintenance_window_${verb}`,
          entityType: ENTITY_TYPE,
          entityId: id,
          reason: body.reason,
          payload: { windowId: id },
        },
        tx,
      );
      return this.itemById(tx, id, scope);
    });
  }

  /** `created_by`/`ended_by` are the `bms.users` row behind the JWT, never a body field. */
  private async requireActorId(actor: Actor): Promise<string> {
    const id = await resolveActorId(this.fleetDb, actor);
    if (id === null) throw new ForbiddenException(NOT_PROVISIONED);
    return id;
  }

  /**
   * The body's targets as rows, de-duplicated, or `null` when one names no row.
   *
   * §4.3 fleet read, by name: **pre-tenant resolution**. The window's
   * organization is derived from its targets (D1), so no tenant is known until
   * this read answers; it is keyed by the body's ids, and its answer is checked
   * against the caller's scope before any write.
   */
  private async resolveTargets(input: readonly MaintenanceWindowTarget[]): Promise<ResolvedTarget[] | null> {
    const ids = (kind: MaintenanceWindowTarget["kind"]): string[] => [
      ...new Set(
        input.flatMap((target) =>
          target.kind !== kind ? [] : [(target.kind === "asset" ? target.assetId : target.kind === "location" ? target.locationId : target.ruleId).toLowerCase()],
        ),
      ),
    ];
    const assetIds = ids("asset");
    const locationIds = ids("location");
    const ruleIds = ids("rule");
    const assetRows =
      assetIds.length === 0
        ? []
        : await this.fleetDb.select({ id: assets.id, organizationId: assets.organizationId }).from(assets).where(inArray(assets.id, assetIds));
    const locationRows =
      locationIds.length === 0
        ? []
        : await this.fleetDb
            .select({ id: locations.id, organizationId: locations.organizationId })
            .from(locations)
            .where(inArray(locations.id, locationIds));
    const ruleRows =
      ruleIds.length === 0
        ? []
        : await this.fleetDb
            .select({ id: automationRules.id, organizationId: automationRules.organizationId, assetId: automationRules.assetId })
            .from(automationRules)
            .where(inArray(automationRules.id, ruleIds));
    if (assetRows.length !== assetIds.length || locationRows.length !== locationIds.length || ruleRows.length !== ruleIds.length) {
      return null;
    }
    return [
      ...assetRows.map((row) => ({ kind: "asset" as const, ...row })),
      ...locationRows.map((row) => ({ kind: "location" as const, ...row })),
      ...ruleRows.map((row) => ({ kind: "rule" as const, ...row })),
    ];
  }

  /**
   * A link outside the window's organization is a 400, not the composite FK's
   * 500, and so is one outside the caller's scope: a work order whose asset it
   * does not read, a schedule whose template's asset it does not read. One text
   * per link for both, so a refusal does not tell an existing row from a
   * missing one. Read inside the window's own tenant transaction, and keyed on
   * the organization as well, so another organization's row answers nothing.
   */
  private async assertLinksInScope(
    tx: BmsTx,
    organizationId: string,
    body: CreateMaintenanceWindowBody,
    scope: MaintenanceWindowReadScope,
  ): Promise<void> {
    const readable = (assetId: string | undefined): boolean =>
      assetId !== undefined && targetInScope({ kind: "asset", id: assetId, organizationId }, scope);
    if (body.workOrderId !== undefined) {
      const [row] = await tx
        .select({ assetId: workOrders.assetId })
        .from(workOrders)
        .where(and(eq(workOrders.id, body.workOrderId), eq(workOrders.organizationId, organizationId)))
        .limit(1);
      if (!readable(row?.assetId)) throw new BadRequestException(WORK_ORDER_REFUSED);
    }
    if (body.maintenanceScheduleId !== undefined) {
      const [row] = await tx
        .select({ assetId: maintenanceTaskTemplates.assetId })
        .from(maintenanceSchedules)
        .innerJoin(maintenanceTaskTemplates, eq(maintenanceTaskTemplates.id, maintenanceSchedules.templateId))
        .where(and(eq(maintenanceSchedules.id, body.maintenanceScheduleId), eq(maintenanceSchedules.organizationId, organizationId)))
        .limit(1);
      if (!readable(row?.assetId)) throw new BadRequestException(SCHEDULE_REFUSED);
    }
  }

  /**
   * The window and its targets for a write, or 404 — for a window that does not
   * exist, for one with no target row, and for one with any target outside the
   * caller's scope alike (D15).
   *
   * §4.3 fleet read, by name: **pre-tenant resolution**. The route names a
   * window id only, so its organization is unknown until this keyed read; the
   * guarded `UPDATE` then runs under `withTenant` on the organization read here.
   */
  private async loadForWrite(id: string, scope: MaintenanceWindowReadScope): Promise<{ organizationId: string }> {
    const [window] = await this.fleetDb
      .select({ organizationId: maintenanceWindows.organizationId })
      .from(maintenanceWindows)
      .where(eq(maintenanceWindows.id, id))
      .limit(1);
    if (!window) throw new NotFoundException(WINDOW_NOT_FOUND);
    const rows = await this.fleetDb
      .select({
        assetId: maintenanceWindowTargets.assetId,
        locationId: maintenanceWindowTargets.locationId,
        ruleId: maintenanceWindowTargets.ruleId,
        ruleAssetId: automationRules.assetId,
      })
      .from(maintenanceWindowTargets)
      .leftJoin(automationRules, eq(automationRules.id, maintenanceWindowTargets.ruleId))
      .where(eq(maintenanceWindowTargets.windowId, id));
    const targets: ResolvedTarget[] = rows.map((row) =>
      row.assetId !== null
        ? { kind: "asset", id: row.assetId, organizationId: window.organizationId }
        : row.locationId !== null
          ? { kind: "location", id: row.locationId, organizationId: window.organizationId }
          : { kind: "rule", id: row.ruleId as string, organizationId: window.organizationId, assetId: row.ruleAssetId },
    );
    if (targets.length === 0 || !everyTargetInScope(targets, scope)) throw new NotFoundException(WINDOW_NOT_FOUND);
    return window;
  }

  private selectRows(tx: BmsTx, where: SQL | undefined, limit: number): Promise<WindowRow[]> {
    return tx
      .select({
        id: maintenanceWindows.id,
        organizationId: maintenanceWindows.organizationId,
        reason: maintenanceWindows.reason,
        startsAt: maintenanceWindows.startsAt,
        endsAt: maintenanceWindows.endsAt,
        endedAt: maintenanceWindows.endedAt,
        state: windowStateSql,
        createdBy: maintenanceWindows.createdBy,
        endedBy: maintenanceWindows.endedBy,
        workOrderId: maintenanceWindows.workOrderId,
        workOrderReference: sql<string | null>`(SELECT w.reference FROM bms.work_orders w WHERE w.id = ${maintenanceWindows.workOrderId})`,
        maintenanceScheduleId: maintenanceWindows.maintenanceScheduleId,
        maintenanceScheduleTitle: sql<string | null>`(SELECT t.title FROM bms.maintenance_schedules s
            JOIN bms.maintenance_task_templates t ON t.id = s.template_id WHERE s.id = ${maintenanceWindows.maintenanceScheduleId})`,
      })
      .from(maintenanceWindows)
      .where(where)
      .orderBy(desc(maintenanceWindows.startsAt), desc(maintenanceWindows.id))
      .limit(limit);
  }

  private async itemById(tx: BmsTx, id: string, scope: MaintenanceWindowReadScope): Promise<MaintenanceWindowItem> {
    const rows = await this.selectRows(tx, eq(maintenanceWindows.id, id), 1);
    const [item] = await this.toItems(tx, rows, scope, await visibleLocationIds(tx, scope), {});
    if (!item) throw new Error("F4.359: the window vanished inside its own transaction");
    return item;
  }

  /**
   * The rows with the targets this caller reads, labelled (`targetVisibleTo`
   * over `visible`, the set the visibility predicate used), and, for an active
   * window, the assets it covers (D16).
   */
  private async toItems(
    tx: BmsTx,
    rows: readonly WindowRow[],
    scope: MaintenanceWindowReadScope,
    visible: readonly string[] | null,
    filters: ItemFilters,
  ): Promise<MaintenanceWindowItem[]> {
    if (rows.length === 0) return [];
    const targetRows = await tx
      .select({
        windowId: maintenanceWindowTargets.windowId,
        assetId: maintenanceWindowTargets.assetId,
        locationId: maintenanceWindowTargets.locationId,
        ruleId: maintenanceWindowTargets.ruleId,
        assetLabel: assets.name,
        assetLocationId: assets.locationId,
        locationLabel: locations.name,
        ruleLabel: automationRules.name,
        ruleAssetId: automationRules.assetId,
      })
      .from(maintenanceWindowTargets)
      .leftJoin(assets, eq(assets.id, maintenanceWindowTargets.assetId))
      .leftJoin(locations, eq(locations.id, maintenanceWindowTargets.locationId))
      .leftJoin(automationRules, eq(automationRules.id, maintenanceWindowTargets.ruleId))
      .where(inArray(maintenanceWindowTargets.windowId, rows.map((row) => row.id)));
    const covered = await this.coveredAssets(tx, rows, targetRows, scope, filters);
    const names = await this.userNames(rows.flatMap((row) => (row.endedBy === null ? [row.createdBy] : [row.createdBy, row.endedBy])));
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      reason: row.reason,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
      state: row.state,
      createdByName: names.get(row.createdBy) ?? "",
      endedByName: row.endedBy === null ? null : (names.get(row.endedBy) ?? null),
      workOrder: row.workOrderId !== null ? { id: row.workOrderId, reference: row.workOrderReference ?? "" } : null,
      maintenanceSchedule:
        row.maintenanceScheduleId !== null ? { id: row.maintenanceScheduleId, title: row.maintenanceScheduleTitle ?? "" } : null,
      targets: targetRows
        .filter((target) => target.windowId === row.id)
        .filter((target) =>
          targetVisibleTo(
            target.assetId !== null
              ? { kind: "asset", id: target.assetId }
              : target.locationId !== null
                ? { kind: "location", id: target.locationId }
                : { kind: "rule", id: target.ruleId as string, assetId: target.ruleAssetId },
            scope,
            visible,
          ),
        )
        .map((target) =>
          target.assetId !== null
            ? { kind: "asset" as const, id: target.assetId, label: target.assetLabel ?? "" }
            : target.locationId !== null
              ? { kind: "location" as const, id: target.locationId, label: target.locationLabel ?? "" }
              : { kind: "rule" as const, id: target.ruleId as string, label: target.ruleLabel ?? "" },
        )
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
      assetIds: covered.get(row.id) ?? [],
    }));
  }

  /**
   * The display names of the page's `created_by`/`ended_by` users.
   *
   * §4.3 fleet read, by name: **an organization-less user**. The global admin
   * (`admin@bms.local`) has `organization_id` NULL, so its `bms.users` row is
   * invisible under every tenant GUC and a tenant read names it "" / null. The
   * read is keyed by the ids on rows this caller already reads (the page), and
   * answers display names only (the `lockedByNameOf` precedent).
   */
  private async userNames(ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.fleetDb.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * D16: for each **active** window, the caller-readable assets it covers as
   * assets — its asset targets, and every asset at or under a location target —
   * inside the request's `assetId`/`locationId` filter. Three statements for the
   * page, whatever its size: the subtree of every location target, the assets
   * there, and each such asset's ancestor chain (which location target covers
   * which asset), all through `auth/location-tree.ts`.
   */
  private async coveredAssets(
    tx: BmsTx,
    rows: readonly WindowRow[],
    targetRows: ReadonlyArray<{ windowId: string; assetId: string | null; locationId: string | null; assetLocationId: string | null }>,
    scope: MaintenanceWindowReadScope,
    filters: ItemFilters,
  ): Promise<Map<string, string[]>> {
    const active = rows.filter((row) => row.state === "active");
    const out = new Map<string, string[]>();
    if (active.length === 0) return out;
    const activeIds = new Set(active.map((row) => row.id));
    const organizationIds = [...new Set(active.map((row) => row.organizationId))];
    const targets = targetRows.filter((target) => activeIds.has(target.windowId));
    const locationTargets = [...new Set(targets.flatMap((target) => (target.locationId === null ? [] : [target.locationId])))];

    /** asset id -> its location id, for every candidate. */
    const candidates = new Map<string, string>();
    for (const target of targets) {
      if (target.assetId !== null && target.assetLocationId !== null) candidates.set(target.assetId, target.assetLocationId);
    }
    let chainOf = new Map<string, Set<string>>();
    if (locationTargets.length > 0) {
      const subtree = await expandLocationSubtrees(tx, { organizationIds, ids: locationTargets });
      const under =
        subtree.length === 0
          ? []
          : await tx.select({ id: assets.id, locationId: assets.locationId }).from(assets).where(inArray(assets.locationId, subtree));
      for (const asset of under) candidates.set(asset.id, asset.locationId);
      const chains = await locationAncestorChains(tx, { organizationIds, ids: [...new Set(under.map((asset) => asset.locationId))] });
      chainOf = new Map();
      for (const link of chains) {
        const set = chainOf.get(link.nodeId) ?? new Set<string>();
        set.add(link.ancestorId);
        chainOf.set(link.nodeId, set);
      }
    }

    const readable = isUnrestricted(scope) ? null : new Set(scope.assetIds ?? []);
    const inFilter = (assetId: string, locationId: string): boolean =>
      (readable === null || readable.has(assetId)) &&
      (filters.asset === undefined || filters.asset.assetId === assetId) &&
      (filters.location === undefined || filters.location.subtreeIds.includes(locationId));

    for (const row of active) {
      const own = targets.filter((target) => target.windowId === row.id);
      const direct = new Set(own.flatMap((target) => (target.assetId === null ? [] : [target.assetId])));
      const viaLocation = new Set(own.flatMap((target) => (target.locationId === null ? [] : [target.locationId])));
      const ids: string[] = [];
      for (const [assetId, locationId] of candidates) {
        const coveredHere =
          direct.has(assetId) || [...(chainOf.get(locationId) ?? [])].some((ancestor) => viaLocation.has(ancestor));
        if (coveredHere && inFilter(assetId, locationId)) ids.push(assetId);
      }
      out.set(row.id, ids.sort());
    }
    return out;
  }
}

/** The database's `now()` (D2): the one clock the route, the raiser and the list share. */
async function databaseNow(tx: BmsTx): Promise<Date> {
  const result = await tx.execute<{ now: Date | string }>(sql`SELECT now() AS now`);
  const value = result.rows[0]?.now;
  if (value === undefined) throw new Error("F4.359: SELECT now() returned no row");
  return new Date(value);
}

/** `withOrganizationReadScope` takes a mutable array; the scope's is read-only. */
function nullableCopy(ids: readonly string[] | null): string[] | null {
  return ids === null ? null : [...ids];
}
