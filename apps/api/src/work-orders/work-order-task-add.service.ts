import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";

import { workOrders, workOrderTasks } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { CreateWorkOrderTaskBody, JwtPayload, WorkOrderTaskDto } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant } from "../database/tenant-context";
import { resolveWorkOrderActor, writeWorkOrderEvent } from "./work-order-events";
import { lockWorkOrderForChecklistWrite, readBackTask, resolveTaskWorkOrderOrganization } from "./work-order-task-write";
import { taskAddRefusal, throwIfRefused } from "./work-order-transitions";

type Actor = Pick<JwtPayload, "sub" | "email">;

/**
 * `E3.1` (ADR 0122 decision 4.3) — one checklist item added to a ticket by hand:
 * `POST /work-orders/:id/tasks`. See `work-order-task-write.ts` for the shape every
 * checklist write shares, and why this is its own service.
 *
 * Authorization is the controller's: the `operational` role gate, then the asset scope
 * it passes in. This service trusts both.
 */
@Injectable()
export class WorkOrderTaskAddService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly db: BmsDb,
    @Inject(MasterDataAuditService) private readonly audit: MasterDataAuditService,
  ) {}

  /** Adds one item to the end of a ticket's checklist (`POST /work-orders/:id/tasks`). */
  async addTask(
    workOrderId: string,
    dto: CreateWorkOrderTaskBody,
    actor: Actor,
    assetIds?: string[] | null,
  ): Promise<WorkOrderTaskDto> {
    const organizationId = await resolveTaskWorkOrderOrganization(this.fleetDb, workOrderId, assetIds);
    const who = await resolveWorkOrderActor(this.fleetDb, actor);
    return withTenant(this.db, organizationId, async (tx) => {
      const ticket = await lockWorkOrderForChecklistWrite(tx, workOrderId);
      // Counted under the row lock, so two concurrent adds cannot both take the last place.
      const [existing] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          lastSortOrder: sql<number>`coalesce(max(${workOrderTasks.sortOrder}), 0)::int`,
        })
        .from(workOrderTasks)
        .where(eq(workOrderTasks.workOrderId, workOrderId));
      throwIfRefused(taskAddRefusal(existing?.count ?? 0));
      const [created] = await tx
        .insert(workOrderTasks)
        .values({
          organizationId,
          workOrderId,
          title: dto.title,
          mandatory: dto.mandatory,
          sortOrder: (existing?.lastSortOrder ?? 0) + 1,
        })
        .returning({ id: workOrderTasks.id });
      if (!created) {
        throw new Error("the checklist item insert returned no row");
      }
      await tx.update(workOrders).set({ updatedAt: new Date() }).where(eq(workOrders.id, workOrderId));

      await this.audit.write(
        {
          actor,
          organizationId,
          action: "work_order_task_create",
          entityType: "work_order",
          entityId: workOrderId,
          reason: "Checklist item added",
          payload: {
            reference: ticket.reference,
            // The title is typed text and stays on the task: the audit row names the item only.
            taskId: created.id,
            mandatory: dto.mandatory,
            oidcSubject: actor.sub,
            actorEmail: actor.email,
          },
        },
        tx,
      );
      await writeWorkOrderEvent(tx, {
        organizationId,
        workOrderId,
        actor: who,
        eventType: "task_updated",
        detail: { taskId: created.id, result: "pending" },
      });
      return readBackTask(tx, workOrderId, created.id);
    });
  }
}
