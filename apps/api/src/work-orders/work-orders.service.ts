import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";

import { alarms, assets, workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  WorkOrderDetail,
  CloseWorkOrderBody,
  CreateWorkOrderBody,
  JwtPayload,
  ReorderWorkOrdersBody,
  UpdateWorkOrderStatusBody,
  WorkOrderListItem,
  WorkOrderStatus,
} from "@bms/shared";

import {
  type AuditInput,
  MasterDataAuditService,
} from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { withReadScope } from "../database/tenant-read-scope";
import { ASSIGNEE_REFUSAL, readActiveOrganizationUser } from "./assignee";
import { countPendingMandatoryTasks } from "./work-order-checklist";
import { insertWorkOrder } from "./work-order-create";
import { readWorkOrderDetail } from "./work-order-detail";
import { resolveWorkOrderActor, statusEventType, type WorkOrderActor, writeWorkOrderEvent } from "./work-order-events";
import { mapWorkOrderRow, readWorkOrderListItem, selectWorkOrderList } from "./work-order-projection";
import { needsChecklistGate, reorderMoveRefusal, statusChangeRefusal, throwIfRefused } from "./work-order-transitions";

/** `F4.284` (owner ruling DC7): read options a route query cannot set — the copilot's `list_work_orders`. */
export type WorkOrderListOptions = {
  /** A case-insensitive title substring, applied in the SQL before the row limit (the `F4.281` lesson). */
  readonly titleSearch?: string;
  /** One status only, in the SQL before the row limit. */
  readonly status?: WorkOrderStatus;
};

/** A substring `ILIKE` pattern with `\`, `%` and `_` escaped, so the search is literal text. */
export function workOrderTitlePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

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
 *
 * `F4.285` (ADR 0106 decision 6): an `assignedTo` on create or status update must be an
 * active user of the work order's organization, read inside the write's own tenant
 * transaction (`assertAssignee`), so the `0047` FORCE policy on `bms.users` backs the
 * explicit organization filter.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    // `F4.284` (ADR 0106 decision 7): every write audits through the funnel, in the write's own
    // `tx`, so a confirmed copilot change carries its `via: "copilot"` mark.
    @Inject(MasterDataAuditService)
    private readonly audit: MasterDataAuditService,
  ) {}

  /**
   * Resolves the acting user once per write: the row id for `createdBy` and the
   * display name the timeline saves (E3.1, ruling P7). `bms.users` is a pre-tenant
   * identity table (Amendment 4 territory), so this reads on `fleetDb` — it must
   * resolve the actor, a global admin included, regardless of any tenant GUC.
   */
  private resolveActor(actor: Pick<JwtPayload, "sub" | "email">): Promise<WorkOrderActor> {
    // F3.78: by subject (or local id), never by email — the shared resolver.
    return resolveWorkOrderActor(this.fleetDb, actor);
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

  /** `F4.285` (ADR 0106 decision 6): an assignee must be an active user of the work order's organization; read inside the write's tenant transaction. */
  private async assertAssignee(tx: BmsTx, assignedTo: string, organizationId: string): Promise<void> {
    if ((await readActiveOrganizationUser(tx, assignedTo, organizationId)) === null) {
      throw new BadRequestException(ASSIGNEE_REFUSAL);
    }
  }

  /** The one organization a batch shares, or a refusal if it spans zero or many. */
  private assertSingleOrg(orgs: (string | null)[], op: string): string {
    if (orgs.length === 0 || orgs.some((org) => !org)) {
      throw new BadRequestException(
        "Work order has no organization; run the 0046 backfill",
      );
    }
    if (new Set(orgs).size !== 1) {
      throw new BadRequestException(
        `A ${op} must stay within a single organization`,
      );
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
  private readWorkOrderById(
    tx: BmsTx,
    id: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    return readWorkOrderListItem(tx, id, assetIds);
  }

  /**
   * Pre-write read on `fleetDb` (pre-GUC), behind the caller's scope. Used by
   * `updateStatus`'s existence/terminal check, which runs before the org is
   * resolved — a NULL-org row must 404 here, not 400 from `resolveWorkOrderOrg`.
   */
  private getById(
    id: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    return this.fleetDb.transaction((tx) =>
      this.readWorkOrderById(tx, id, assetIds),
    );
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
  async list(
    opts: {
      limit: number;
      assetIds?: string[] | null;
    },
    options: WorkOrderListOptions = {},
  ): Promise<{ items: WorkOrderListItem[] }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    const filters: SQL[] = [
      ...(opts.assetIds ? [inArray(workOrders.assetId, opts.assetIds)] : []),
      ...(options.titleSearch
        ? [ilike(workOrders.title, workOrderTitlePattern(options.titleSearch))]
        : []),
      ...(options.status ? [eq(workOrders.status, options.status)] : []),
    ];
    return withReadScope(
      this.db,
      this.fleetDb,
      opts.assetIds,
      () => ({ items: [] }),
      async (tx) => {
        const base = selectWorkOrderList(tx);
        // One clock for the page, so two rows never disagree about `slaState`.
        const now = new Date();
        const rows = await base
          .where(filters.length > 0 ? and(...filters) : undefined)
          .orderBy(
            asc(workOrders.status),
            asc(workOrders.sortOrder),
            desc(workOrders.createdAt),
            desc(workOrders.id),
          )
          .limit(limit);
        return { items: rows.map((row) => mapWorkOrderRow(row, now)) };
      },
    );
  }

  /**
   * One work order with its timeline and its alarm (E3.1, `GET /work-orders/:id`).
   * Reads through `withReadScope`, like `list`: a single-organization actor is served
   * under the tenant setting, and an actor with no readable asset gets the same 404 as
   * for a ticket that does not exist.
   */
  async getDetail(id: string, assetIds?: string[] | null): Promise<WorkOrderDetail> {
    return withReadScope<WorkOrderDetail>(
      this.db,
      this.fleetDb,
      assetIds,
      () => {
        throw new NotFoundException("Work order not found");
      },
      (tx) => readWorkOrderDetail(tx, id, assetIds),
    );
  }

  /** Creates a work order linked to an asset and optionally an alarm. */
  async create(
    dto: CreateWorkOrderBody,
    actor: Pick<JwtPayload, "sub" | "email">,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    if (assetIds && !assetIds.includes(dto.assetId)) {
      throw new NotFoundException(
        "Asset not found or outside your access scope",
      );
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

    const who = await this.resolveActor(actor);
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
      if (dto.assignedTo) {
        await this.assertAssignee(tx, dto.assignedTo, organizationId);
      }

      // E3.1 (ADR 0122, plan D3): the one insert path — it allocates the reference and
      // snapshots the SLA inside this transaction.
      const created = await insertWorkOrder(tx, {
        organizationId,
        assetId: dto.assetId,
        alarmId: dto.alarmId,
        title: dto.title,
        description: dto.description,
        status: dto.assignedTo ? "assigned" : "open",
        priority: dto.priority,
        assignedTo: dto.assignedTo,
        actor: who,
        origin: dto.alarmId ? "alarm" : "manual",
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        slaMinutes: dto.slaMinutes,
        // The person picked this template on the form just now: one that cannot be used
        // fails the create (decision 4.3).
        checklist: dto.checklistTemplateId ? { templateId: dto.checklistTemplateId, ifUnusable: "refuse" } : undefined,
      });

      // E7.1c (item D): folded into this transaction (was a separate
      // `this.db.insert` after it closed) so the stamped organizationId
      // matches the GUC the strict WITH CHECK now demands.
      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_create",
          entityType: "work_order",
          entityId: created.id,
          reason: "Work order created",
          payload: {
            reference: created.reference,
            slaMinutes: created.slaMinutes,
            slaSource: created.slaSource,
            checklistTemplateId: created.checklistTemplateId,
            checklistItems: created.checklistItems,
            assetId: dto.assetId,
            alarmId: dto.alarmId ?? null,
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      return created.id;
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
    // Refused early for a ticket that is already closed, before any transaction opens.
    // The final answer is the one under the row lock, below (plan D9).
    throwIfRefused(statusChangeRefusal({ from: current.status, to: dto.status, pendingMandatory: 0 }));

    const organizationId = await this.resolveWorkOrderOrg(id, assetIds);
    const who = await this.resolveActor(actor);
    const now = new Date();
    await withTenant(this.db, organizationId, async (tx) => {
      // E3.1: lock the row and decide from what the lock shows, not from `current`,
      // which was read before this transaction. Two writes that overlap would otherwise
      // both act on the same old status: one could reopen a ticket the other just
      // closed, and the timeline would record a move that never happened, or none.
      const [locked] = await tx
        .select({ status: workOrders.status, assignedTo: workOrders.assignedTo, sortOrder: workOrders.sortOrder })
        .from(workOrders)
        .where(eq(workOrders.id, id))
        .for("update");
      if (!locked) {
        throw new NotFoundException("Work order not found");
      }
      const fromStatus = locked.status as WorkOrderStatus;
      // E3.1 (decision 4.4): a mandatory checklist item still pending blocks the move
      // into `resolved`, and into `closed` straight from a live status (409). The count is read under the row lock; a checklist write
      // takes the same lock first, so it cannot change between this read and the commit.
      const pendingMandatory = needsChecklistGate(fromStatus, dto.status) ? await countPendingMandatoryTasks(tx, id) : 0;
      throwIfRefused(statusChangeRefusal({ from: fromStatus, to: dto.status, pendingMandatory }));
      // `F4.285` (DC-D): `null` clears the assignee and an omitted field keeps it — neither reads a user.
      if (typeof dto.assignedTo === "string") {
        await this.assertAssignee(tx, dto.assignedTo, organizationId);
      }
      await tx
        .update(workOrders)
        .set({
          status: dto.status,
          sortOrder: dto.sortOrder,
          assignedTo: dto.assignedTo === undefined ? undefined : dto.assignedTo,
          // E3.1: stamp only on the real transition. The SLA state reads `resolvedAt`
          // (ADR 0122 decision 3.4), so re-stamping a ticket that is already resolved
          // would turn a `met` SLA into `missed`.
          resolvedAt: dto.status === "resolved" && fromStatus !== "resolved" ? now : undefined,
          closedAt: dto.status === "closed" ? now : undefined,
          updatedAt: now,
        })
        .where(eq(workOrders.id, id));

      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_status_update",
          entityType: "work_order",
          entityId: id,
          reason: dto.reason ?? `Status changed to ${dto.status}`,
          payload: {
            reference: current.reference,
            fromStatus,
            toStatus: dto.status,
            sortOrder: dto.sortOrder ?? locked.sortOrder,
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );

      // E3.1 (ADR 0122 decision 7.3): the timeline, in this same transaction. A write
      // that only moves the card within its column changes nothing a reader would call
      // an event, so it writes none.
      const event = { organizationId, workOrderId: id, actor: who };
      // Postgres answers a uuid in lower case; the body's may be upper case.
      const assignedTo = dto.assignedTo?.toLowerCase() ?? dto.assignedTo;
      if (assignedTo !== undefined && assignedTo !== locked.assignedTo) {
        await writeWorkOrderEvent(tx, {
          ...event,
          eventType: "assigned",
          fromStatus,
          toStatus: dto.status,
          detail: { assignedTo },
        });
      }
      if (dto.status !== fromStatus) {
        await writeWorkOrderEvent(tx, {
          ...event,
          eventType: statusEventType(dto.status),
          fromStatus,
          toStatus: dto.status,
          detail: dto.reason === undefined ? {} : { reason: dto.reason },
        });
      }
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
      throw new BadRequestException(
        "Duplicate work order ids in reorder request",
      );
    }

    const currentRows = await this.fleetDb
      .select({
        id: workOrders.id,
        status: workOrders.status,
        reference: workOrders.reference,
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

    // The moves are checked twice: here, so a bad request is refused before any
    // transaction opens, and again under the row locks, where the answer is final.
    const assertMoves = (statusById: ReadonlyMap<string, WorkOrderStatus>): void => {
      for (const item of dto.items) {
        const currentStatus = statusById.get(item.id);
        if (!currentStatus) {
          throw new NotFoundException("Work order not found");
        }
        // No drag into or out of Done, and none into Resolved (ruling P1): plan D9.
        throwIfRefused(reorderMoveRefusal({ from: currentStatus, to: item.status }));
      }
    };
    assertMoves(new Map(currentRows.map((row) => [row.id, row.status as WorkOrderStatus])));

    const referenceById = new Map(currentRows.map((row) => [row.id, row.reference]));
    const who = await this.resolveActor(actor);
    const now = new Date();
    await withTenant(this.db, organizationId, async (tx) => {
      // E3.1: lock the batch's rows, in id order so two overlapping drags cannot
      // deadlock, and decide from the locked statuses — see `updateStatus`.
      const lockedRows = await tx
        .select({ id: workOrders.id, status: workOrders.status })
        .from(workOrders)
        .where(inArray(workOrders.id, ids))
        .orderBy(asc(workOrders.id))
        .for("update");
      const currentById = new Map(lockedRows.map((row) => [row.id, row.status as WorkOrderStatus]));
      assertMoves(currentById);

      // One actor lookup and one insert for the whole batch (`writeMany`), not one per moved item.
      const audits: AuditInput[] = [];
      for (const item of dto.items) {
        const currentStatus = currentById.get(item.id);
        await tx
          .update(workOrders)
          .set({
            status: item.status,
            sortOrder: item.sortOrder,
            // No `resolvedAt` stamp here: a reorder can no longer move a ticket into
            // `resolved` (ruling P1), so only `updateStatus` stamps it.
            updatedAt: now,
          })
          .where(eq(workOrders.id, item.id));

        if (currentStatus && currentStatus !== item.status) {
          audits.push({
            actor,
            organizationId,
            action: "work_order_status_update",
            entityType: "work_order",
            entityId: item.id,
            reason: dto.reason ?? `Moved to ${item.status} by Kanban drag`,
            payload: {
              reference: referenceById.get(item.id) ?? null,
              fromStatus: currentStatus,
              toStatus: item.status,
              sortOrder: item.sortOrder,
              oidcSubject: actor.sub,
              actorEmail: actor.email,
            },
          });
          // E3.1 (decision 7.3): one event per ticket whose status changed, in this
          // transaction. A row that only changed position writes none.
          await writeWorkOrderEvent(tx, {
            organizationId,
            workOrderId: item.id,
            actor: who,
            eventType: statusEventType(item.status),
            fromStatus: currentStatus,
            toStatus: item.status,
            detail: dto.reason === undefined ? {} : { reason: dto.reason },
          });
        }
      }

      audits.push({
        actor,
        organizationId,
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
      await this.audit.writeMany(audits, tx);
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
