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

import { TENANT_DRIZZLE } from "../database/database.tokens";
import type {
  CloseWorkOrderBody,
  CreateWorkOrderBody,
  ReorderWorkOrdersBody,
  UpdateWorkOrderStatusBody,
} from "./work-order.schema";

const terminalStatuses = new Set<WorkOrderStatus>(["closed"]);

@Injectable()
export class WorkOrdersService {
  constructor(@Inject(TENANT_DRIZZLE) private readonly db: BmsDb) {}

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

  private async resolveActorId(
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<string | null> {
    const [actorRow] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.id, actor.sub), eq(users.email, actor.email)))
      .limit(1);
    return actorRow?.id ?? null;
  }

  private async getById(
    id: string,
    assetIds?: string[] | null,
  ): Promise<WorkOrderListItem> {
    const [row] = await this.db
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

  /** Lists recent work orders for the Sprint A API. */
  async list(opts: {
    limit: number;
    assetIds?: string[] | null;
  }): Promise<{ items: WorkOrderListItem[] }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    if (opts.assetIds && opts.assetIds.length === 0) {
      return { items: [] };
    }
    const base = this.db
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
    const [asset] = await this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.id, dto.assetId))
      .limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    if (dto.alarmId) {
      const [alarm] = await this.db
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

    const actorId = await this.resolveActorId(actor);
    const [created] = await this.db
      .insert(workOrders)
      .values({
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

    await this.db.insert(auditLog).values({
      actorId,
      action: "work_order_create",
      entityType: "work_order",
      entityId: created.id,
      reason: "Work order created",
      payload: {
        assetId: dto.assetId,
        alarmId: dto.alarmId ?? null,
        oidcSubject: actor.sub,
        actorEmail: actor.email,
      },
    });

    return this.getById(created.id, assetIds);
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

    const now = new Date();
    const actorId = await this.resolveActorId(actor);
    await this.db.transaction(async (tx) => {
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

    return this.getById(id, assetIds);
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

    const currentRows = await this.db
      .select({ id: workOrders.id, status: workOrders.status })
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
    await this.db.transaction(async (tx) => {
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

    const items = await Promise.all(ids.map((id) => this.getById(id, assetIds)));
    return { items };
  }
}
