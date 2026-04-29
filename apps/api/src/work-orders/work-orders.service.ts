import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { desc, eq, or } from "drizzle-orm";

import { alarms, assets, auditLog, users, workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type {
  JwtPayload,
  WorkOrderListItem,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@bms/shared";

import { DRIZZLE } from "../database/database.tokens";
import type {
  CreateWorkOrderBody,
  UpdateWorkOrderStatusBody,
} from "./work-order.schema";

const terminalStatuses = new Set<WorkOrderStatus>(["closed"]);

@Injectable()
export class WorkOrdersService {
  constructor(@Inject(DRIZZLE) private readonly db: BmsDb) {}

  private mapRow(r: {
    id: string;
    assetId: string;
    alarmId: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
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

  private async getById(id: string): Promise<WorkOrderListItem> {
    const [row] = await this.db
      .select({
        id: workOrders.id,
        assetId: workOrders.assetId,
        alarmId: workOrders.alarmId,
        title: workOrders.title,
        description: workOrders.description,
        status: workOrders.status,
        priority: workOrders.priority,
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
      .where(eq(workOrders.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Work order not found");
    }
    return this.mapRow(row);
  }

  /** Lists recent work orders for the Sprint A API. */
  async list(opts: { limit: number }): Promise<{ items: WorkOrderListItem[] }> {
    const limit = Math.min(100, Math.max(1, opts.limit));
    const rows = await this.db
      .select({
        id: workOrders.id,
        assetId: workOrders.assetId,
        alarmId: workOrders.alarmId,
        title: workOrders.title,
        description: workOrders.description,
        status: workOrders.status,
        priority: workOrders.priority,
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
      .orderBy(desc(workOrders.createdAt), desc(workOrders.id))
      .limit(limit);
    return { items: rows.map((row) => this.mapRow(row)) };
  }

  /** Creates a work order linked to an asset and optionally an alarm. */
  async create(
    dto: CreateWorkOrderBody,
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<WorkOrderListItem> {
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

    return this.getById(created.id);
  }

  /** Updates a work order status and records the state change in audit log. */
  async updateStatus(
    id: string,
    dto: UpdateWorkOrderStatusBody,
    actor: Pick<JwtPayload, "sub" | "email">,
  ): Promise<WorkOrderListItem> {
    const current = await this.getById(id);
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
          oidcSubject: actor.sub,
          actorEmail: actor.email,
        },
      });
    });

    return this.getById(id);
  }

  /** Closes a work order and records the closure reason. */
  async close(
    id: string,
    actor: Pick<JwtPayload, "sub" | "email">,
    reason: string,
  ): Promise<WorkOrderListItem> {
    return this.updateStatus(id, { status: "closed", reason }, actor);
  }
}
