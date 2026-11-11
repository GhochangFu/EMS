import { NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";

import { workOrders } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { WorkOrderStatus, WorkOrderTaskDto } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import { readWorkOrderTask } from "./work-order-checklist";
import { taskWriteRefusal, throwIfRefused } from "./work-order-transitions";

/**
 * `E3.1` (ADR 0122 decision 4) — what the two checklist writes share. They are two
 * services, `WorkOrderTaskAddService` and `WorkOrderTasksService`, because each serves
 * one route the copilot catalog excludes and `tests/f3.85-audit-via-mark.test.ts` ties
 * one such service to exactly one handler.
 *
 * A checklist write follows the shape of a status write (`WorkOrdersService`): the
 * ticket's organization is resolved on the fleet pool behind the caller's asset scope,
 * then everything else runs in ONE `withTenant` transaction — the work order's row
 * lock, the task write, the audit row and the `task_updated` timeline event — so they
 * commit or roll back together.
 *
 * **The row lock is what makes the resolve gate sound.** `WorkOrdersService.updateStatus`
 * locks the same work-order row and counts the mandatory items still pending under it.
 * A checklist write that could set an item back to `pending`, or add a mandatory one,
 * waits for that lock and then reads the status the resolve committed; a `resolved` or
 * `closed` ticket refuses it (409).
 */

export const WORK_ORDER_NOT_FOUND = "Work order not found";
export const TASK_NOT_FOUND = "Checklist item not found";

/** What a checklist write needs to know about its ticket, read under the row lock. */
export type LockedWorkOrder = { readonly reference: string; readonly status: WorkOrderStatus };

/**
 * The ticket's organization, read on the fleet pool behind the caller's asset scope.
 * The fleet pool, because no tenant setting can exist before the organization is
 * known. 404 when the ticket is absent or out of scope: the two read the same.
 */
export async function resolveTaskWorkOrderOrganization(
  fleetDb: BmsDb,
  workOrderId: string,
  assetIds?: string[] | null,
): Promise<string> {
  if (assetIds && assetIds.length === 0) {
    throw new NotFoundException(WORK_ORDER_NOT_FOUND);
  }
  const [row] = await fleetDb
    .select({ organizationId: workOrders.organizationId })
    .from(workOrders)
    .where(and(eq(workOrders.id, workOrderId), ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : [])))
    .limit(1);
  if (!row) {
    throw new NotFoundException(WORK_ORDER_NOT_FOUND);
  }
  return row.organizationId;
}

/** Locks the ticket's row and refuses a checklist write on a `resolved` or `closed` ticket (409). */
export async function lockWorkOrderForChecklistWrite(tx: BmsTx, workOrderId: string): Promise<LockedWorkOrder> {
  const [locked] = await tx
    .select({ reference: workOrders.reference, status: workOrders.status })
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .for("update");
  if (!locked) {
    throw new NotFoundException(WORK_ORDER_NOT_FOUND);
  }
  const status = locked.status as WorkOrderStatus;
  throwIfRefused(taskWriteRefusal(status));
  return { reference: locked.reference, status };
}

/** The task as the write left it, read in the write's own transaction. */
export async function readBackTask(tx: BmsTx, workOrderId: string, taskId: string): Promise<WorkOrderTaskDto> {
  const task = await readWorkOrderTask(tx, workOrderId, taskId);
  if (task === null) {
    throw new NotFoundException(TASK_NOT_FOUND);
  }
  return task;
}
