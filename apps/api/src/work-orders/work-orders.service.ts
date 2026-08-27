import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";

import { alarms, assets, auditLog, users, workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import type {
  CloseWorkOrderBody,
  CreateWorkOrderBody,
  ReorderWorkOrdersBody,
  UpdateWorkOrderStatusBody,
} from "./work-order.schema";

const terminalStatuses = new Set<WorkOrderStatus>(["closed"]);

/**
 * `E7.1b` (ADR 0043 §5, decisions 1+3) — `work_orders` gained an
 * `organization_id` column (migration `0046`, org = `asset_id → assets.org`) and
 * a `tenant_isolation` policy + `FORCE` in `0047`. The user-facing `list` reads
 * through `withReadScope`: a single-organization actor is served inside
 * `withTenant` (decision 1, the RLS backstop); an admin or multi-organization
 * actor falls back to `fleetDb` at run time (decisions 2/3), where the
 * `assetIds` filter is the isolation control. Writes run inside
 * `withTenant(db, org, …)`, org derived from the asset on create and from the
 * row's own column on update/reorder.
 *
 * The write-path reads stay on `fleetDb`: `resolveWorkOrderOrg` and `reorder`'s
 * pre-check resolve the org before any GUC exists, and `resolveActorId` reads
 * the pre-tenant `bms.users` identity — after `0047`'s NULL-tolerant `users`
 * policy a scoped actor's row is invisible to a bare tenant pool (no
 * `current_org`), which would silently drop the audit actor. `updateStatus`'s
 * pre-write existence/terminal check also stays on `fleetDb` (`getById`), before
 * the org is resolved. **E7.1c** closed the E7.1b read-back residual: the private
 * post-write read-backs now run on the tenant pool under the write's org
 * (`readBackWorkOrder`), so a single-org write reads its result back under the
 * `0047` FORCE policy rather than the unconditional fleet pool (decision 1).
 *
 * A Kanban reorder is single-organization by construction — one board shows one
 * org's assets — so a batch that resolves to more than one organization is a
 * malformed request, refused rather than split across tenant transactions. The
 * `audit_log` rows carry no `organization_id` this item (ruling 5, deferred to
 * E7.1c); their inserts pass the NULL-tolerant `WITH CHECK` under any GUC.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
  ) {}

  private mapRow(r: {
    id: string;
    assetId: string;
    alarmId: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    sortOrder: number;
    assignedTo: string | null;
    createdBy: string | null;
    dueAt: Date | null;
    resolvedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    assetCode: string;
    assetName: string;
    siteName: string;
  }): WorkOrderListItem {
    return {
      id: r.id,
      assetId: r.assetId,
      alarmId: r.alarmId,
      title: r.title,
      description: r.description,
      status: r.status as WorkOrderStatus,
      priority: r.priority as WorkOrderPriority,
      sortOrder: r.sortOrder,
      assignedTo: r.assignedTo,
      createdBy: r.createdBy,
      dueAt: r.dueAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      closedAt: r.closedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      assetCode: r.assetCode,
      assetName: r.assetName,
      siteName: r.siteName,
    };
  }

  /**
   * Resolves the acting user's row id. `bms.users` is a pre-tenant identity
   * table (Amendment 4 territory), so this reads on `fleetDb` — it must resolve
   * the actor regardless of any tenant GUC.
   */
  private async resolveActorId(
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<string | null> {
    const [actorRow] = await this.fleetDb
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    return actorRow?.id ?? null;
  }

  /**
   * The organization a single work order belongs to, read on `fleetDb` behind
   * the caller's writable-asset scope. Null org means the `0046` backfill has
   * not run for the row — refused rather than written with a NULL tenant.
   */
  private async resolveWorkOrderOrg(
    id: string,
    assetIds?: string[] | null,
  ): Promise<string> {
    const [row] = await this.fleetDb
      .select({ organizationId: workOrders.organizationId })
      .from(workOrders)
      .where(
        and(
          eq(workOrders.id, id),
          ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row?.organizationId) {
      throw new BadRequestException(
        "Work order has no organization; run the 0046 backfill",
      );
    }
    return row.organizationId;
  }

  /** The one organization a batch shares, or a refusal if it spans zero or many. */
  private assertSingleOrg(orgs: (string | null)[], op: string): string {
    if (orgs.length === 0 || orgs.some((org) => !org)) {
      throw new BadRequestException(
        "Work order has no organization; run the 0046 backfill",
      );
    }
    if (new Set(orgs).size !== 1) {
      throw new BadRequestException(`A ${op} must stay within a single organization`);
    }
    return orgs[0] as string;
  }

  /**
   * Reads one work order's list projection on the passed transaction handle. Two
   * callers wrap it differently: the pre-write existence/terminal check
   * (`getById`) wraps it in a `fleetDb.transaction` — a pre-GUC read behind the
   * caller's scope, like `resolveWorkOrderOrg`; the post-write read-back
   * (`readBackWorkOrder`) wraps it in `withTenant`, so a single-org write reads
   * its result back under the org GUC (ADR 0043 decision 1).
   */
  private async readWorkOrderById(
    tx: BmsTx,
    id: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    const [row] = await tx
      .select({
        id: workOrders.id,
        assetId: workOrders.assetId,
        alarmId: workOrders.alarmId,
        title: workOrders.title,
        description: workOrders.description,
        status: workOrders.status,
        priority: workOrders.priority,
        sortOrder: workOrders.sortOrder,
        assignedTo: workOrders.assignedTo,
        createdBy: workOrders.createdBy,
        dueAt: workOrders.dueAt,
        resolvedAt: workOrders.resolvedAt,
        closedAt: workOrders.closedAt,
        createdAt: workOrders.createdAt,
        updatedAt: workOrders.updatedAt,
        assetCode: assets.code,
        assetName: assets.name,
        siteName: assets.siteName,
      })
      .from(workOrders)
      .innerJoin(assets, eq(workOrders.assetId, assets.id))
      .where(
        and(
          eq(workOrders.id, id),
          ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : []),
        ),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Work order not found");
    }
    return this.mapRow(row);
  }

  /**
   * Pre-write read on `fleetDb` (pre-GUC), behind the caller's scope. Used by
   * `updateStatus`'s existence/terminal check, which runs before the org is
   * resolved — a NULL-org row must 404 here, not 400 from `resolveWorkOrderOrg`.
   */
  private getById(id: string, assetIds?: string[] | null): Promise<WorkOrderListItem> {
    return this.fleetDb.transaction((tx) => this.readWorkOrderById(tx, id, assetIds));
  }

  /**
   * Post-write read-back on the **tenant** pool (E7.1c, ADR 0043 decision 1). A
   * single-org write reads its result back under its own org GUC rather than on
   * the unconditional fleet pool. It runs in its own `withTenant` — not folded
   * into the write transaction the way `alarms.acknowledge` does — because
   * `work_orders` has no `fleetDb.transaction` on any path for `countingDb` to
   * observe a fold through, so a distinct tenant transaction is what keeps the
   * routing assertable (work-orders `.rls.integration` proof).
   */
  private readBackWorkOrder(
    id: string,
    organizationId: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    return withTenant(this.db, organizationId, (tx) =>
      this.readWorkOrderById(tx, id, assetIds),
    );
  }

  /** Lists recent work orders for the Sprint A API. */
  async list(opts: {
    limit: number;
    assetIds?: string[] | null;
  }): Promise<{ items: WorkOrderListItem[] }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    return withReadScope(
      this.db,
      this.fleetDb,
      opts.assetIds,
      () => ({ items: [] }),
      async (tx) => {
        const base = tx
          .select({
            id: workOrders.id,
            assetId: workOrders.assetId,
            alarmId: workOrders.alarmId,
            title: workOrders.title,
            description: workOrders.description,
            status: workOrders.status,
            priority: workOrders.priority,
            sortOrder: workOrders.sortOrder,
            assignedTo: workOrders.assignedTo,
            createdBy: workOrders.createdBy,
            dueAt: workOrders.dueAt,
            resolvedAt: workOrders.resolvedAt,
            closedAt: workOrders.closedAt,
            createdAt: workOrders.createdAt,
            updatedAt: workOrders.updatedAt,
            assetCode: assets.code,
            assetName: assets.name,
            siteName: assets.siteName,
          })
          .from(workOrders)
          .innerJoin(assets, eq(workOrders.assetId, assets.id));
        const rows = await (opts.assetIds
          ? base
              .where(inArray(workOrders.assetId, opts.assetIds))
              .orderBy(
                asc(workOrders.status),
                asc(workOrders.sortOrder),
                desc(workOrders.createdAt),
                desc(workOrders.id),
              )
              .limit(limit)
          : base
              .orderBy(
                asc(workOrders.status),
                asc(workOrders.sortOrder),
                desc(workOrders.createdAt),
                desc(workOrders.id),
              )
              .limit(limit));
        return { items: rows.map((row) => this.mapRow(row)) };
      },
    );
  }

  /** Creates a work order linked to an asset and optionally an alarm. */
  async create(
    dto: CreateWorkOrderBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    if (assetIds && !assetIds.includes(dto.assetId)) {
      throw new NotFoundException("Asset not found or outside your access scope");
    }
    const [asset] = await this.fleetDb
      .select({ id: assets.id, organizationId: assets.organizationId })
      .from(assets)
      .where(eq(assets.id, dto.assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    if (!asset.organizationId) {
      throw new BadRequestException(
        "Asset has no organization; run the 0046 backfill",
      );
    }
    const organizationId = asset.organizationId;

    const actorId = await this.resolveActorId(actor);
    const createdId = await withTenant(this.db, organizationId, async (tx) => {
      // The alarm consistency read runs inside the tenant GUC: a foreign-org
      // alarm reads as absent under the policy, so it cannot be attached and its
      // existence is not disclosed.
      if (dto.alarmId) {
        const [alarm] = await tx
          .select({ id: alarms.id, assetId: alarms.assetId })
          .from(alarms)
          .where(eq(alarms.id, dto.alarmId))
          .limit(1);
        if (!alarm) {
          throw new NotFoundException("Alarm not found");
        }
        if (alarm.assetId !== dto.assetId) {
          throw new BadRequestException(
            "Alarm does not belong to the selected asset",
          );
        }
      }

      const [created] = await tx
        .insert(workOrders)
        .values({
          organizationId,
          assetId: dto.assetId,
          alarmId: dto.alarmId,
          title: dto.title,
          description: dto.description,
          status: dto.assignedTo ? "assigned" : "open",
          priority: dto.priority,
          assignedTo: dto.assignedTo,
          createdBy: actorId,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        })
        .returning({ id: workOrders.id });
      if (!created) {
        throw new BadRequestException("Could not create work order");
      }
      return created.id;
    });

    await this.db.insert(auditLog).values({
      actorId,
      action: "work_order_create",
      entityType: "work_order",
      entityId: createdId,
      reason: "Work order created",
      payload: {
        assetId: dto.assetId,
        alarmId: dto.alarmId ?? null,
        oidcSubject: actor.sub,
        actorEmail: actor.email,
      },
    });

    return this.readBackWorkOrder(createdId, organizationId, assetIds);
  }

  /** Updates a work order status and records the state change in audit log. */
  async updateStatus(
    id: string,
    dto: UpdateWorkOrderStatusBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    const current = await this.getById(id, assetIds);
    if (terminalStatuses.has(current.status)) {
      throw new BadRequestException("Closed work orders cannot be updated");
    }

    const organizationId = await this.resolveWorkOrderOrg(id, assetIds);
    const now = new Date();
    const actorId = await this.resolveActorId(actor);
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .update(workOrders)
        .set({
          status: dto.status,
          sortOrder: dto.sortOrder,
          assignedTo: dto.assignedTo === undefined ? undefined : dto.assignedTo,
          resolvedAt: dto.status === "resolved" ? now : undefined,
          closedAt: dto.status === "closed" ? now : undefined,
          updatedAt: now,
        })
        .where(eq(workOrders.id, id));

      await tx.insert(auditLog).values({
        actorId,
        action: "work_order_status_update",
        entityType: "work_order",
        entityId: id,
        reason: dto.reason ?? `Status changed to ${dto.status}`,
        payload: {
          fromStatus: current.status,
          toStatus: dto.status,
          sortOrder: dto.sortOrder ?? current.sortOrder,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });

    return this.readBackWorkOrder(id, organizationId, assetIds);
  }

  /** Closes a work order and records the closure reason. */
  async close(
    id: string,
    actor: Pick<JwtPayload, "sub" | "email">,
    dto: CloseWorkOrderBody,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    return this.updateStatus(
      id,
      { status: "closed", reason: dto.reason, sortOrder: dto.sortOrder },
      actor,
      assetIds,
    );
  }

  /** Persists Kanban order and audited status transitions from drag/drop. */
  async reorder(
    dto: ReorderWorkOrdersBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<{ items: WorkOrderListItem[] }> {
    if (assetIds && assetIds.length === 0) {
      throw new NotFoundException("One or more work orders were not found");
    }
    const ids = dto.items.map((item) => item.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new BadRequestException("Duplicate work order ids in reorder request");
    }

    const currentRows = await this.fleetDb
      .select({
        id: workOrders.id,
        status: workOrders.status,
        organizationId: workOrders.organizationId,
      })
      .from(workOrders)
      .where(
        and(
          inArray(workOrders.id, ids),
          ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : []),
        ),
      );
    if (currentRows.length !== ids.length) {
      throw new NotFoundException("One or more work orders were not found");
    }
    const organizationId = this.assertSingleOrg(
      currentRows.map((row) => row.organizationId),
      "reorder",
    );

    const currentById = new Map(
      currentRows.map((row) => [row.id, row.status as WorkOrderStatus]),
    );
    for (const item of dto.items) {
      const currentStatus = currentById.get(item.id);
      if (!currentStatus) {
        throw new NotFoundException("Work order not found");
      }
      if (currentStatus === "closed" && item.status !== "closed") {
        throw new BadRequestException("Closed work orders cannot be reopened");
      }
      if (currentStatus !== "closed" && item.status === "closed") {
        throw new BadRequestException("Use the close workflow for Done");
      }
    }

    const now = new Date();
    const actorId = await this.resolveActorId(actor);
    await withTenant(this.db, organizationId, async (tx) => {
      for (const item of dto.items) {
        const currentStatus = currentById.get(item.id);
        await tx
          .update(workOrders)
          .set({
            status: item.status,
            sortOrder: item.sortOrder,
            resolvedAt: item.status === "resolved" ? now : undefined,
            updatedAt: now,
          })
          .where(eq(workOrders.id, item.id));

        if (currentStatus && currentStatus !== item.status) {
          await tx.insert(auditLog).values({
            actorId,
            action: "work_order_status_update",
            entityType: "work_order",
            entityId: item.id,
            reason: dto.reason ?? `Moved to ${item.status} by Kanban drag`,
            payload: {
              fromStatus: currentStatus,
              toStatus: item.status,
              sortOrder: item.sortOrder,
              oidcSubject: actor.sub,
              actorEmail: actor.email,
            },
          });
        }
      }

      await tx.insert(auditLog).values({
        actorId,
        action: "work_order_reorder",
        entityType: "work_order",
        entityId: null,
        reason: dto.reason ?? "Kanban order updated",
        payload: {
          count: dto.items.length,
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });

    // E7.1c: the N post-write read-backs run in ONE additional tenant
    // transaction (not one per id, and not on the fleet pool), so a single-org
    // reorder shows exactly two tenant transactions regardless of batch size.
    const items = await withTenant(this.db, organizationId, async (tx) => {
      const rows: WorkOrderListItem[] = [];
      for (const id of ids) {
        rows.push(await this.readWorkOrderById(tx, id, assetIds));
      }
      return rows;
    });
    return { items };
  }
}
