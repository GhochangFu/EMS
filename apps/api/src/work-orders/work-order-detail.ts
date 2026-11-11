import { asc, eq } from "drizzle-orm";

import { alarms, workOrderEvents } from "@bms/db";
import { workOrderEventDetailSchema } from "@bms/shared";
import type { WorkOrderDetail, WorkOrderEventDto, WorkOrderEventType, WorkOrderStatus } from "@bms/shared";

import { Logger } from "@nestjs/common";

import type { BmsTx } from "../database/tenant-context";
import { readWorkOrderTasks } from "./work-order-checklist";
import { readWorkOrderListItem } from "./work-order-projection";

const logger = new Logger("WorkOrderDetail");

/**
 * `E3.1` (ADR 0122 decisions 4, 7.3 and 8) — one work order with its timeline, its
 * checklist and the alarm it was raised from: `GET /work-orders/:id`.
 *
 * The caller chooses the transaction (`withReadScope`); this only reads on it. The item
 * read enforces the caller's asset scope and throws 404 when the ticket is absent or
 * out of scope, BEFORE any event or task is read, so the timeline and the checklist of an
 * unseen ticket are never touched.
 */
export async function readWorkOrderDetail(
  tx: BmsTx,
  id: string,
  assetIds?: string[] | null,
): Promise<WorkOrderDetail> {
  const item = await readWorkOrderListItem(tx, id, assetIds);

  const eventRows = await tx
    .select({
      id: workOrderEvents.id,
      eventType: workOrderEvents.eventType,
      // The SAVED name (ruling P7). No join to `bms.users`: a tenant reader could not
      // read a global admin's row there.
      actorName: workOrderEvents.actorName,
      fromStatus: workOrderEvents.fromStatus,
      toStatus: workOrderEvents.toStatus,
      detail: workOrderEvents.detail,
      createdAt: workOrderEvents.createdAt,
    })
    .from(workOrderEvents)
    .where(eq(workOrderEvents.workOrderId, id))
    .orderBy(asc(workOrderEvents.createdAt), asc(workOrderEvents.id));

  const events: WorkOrderEventDto[] = eventRows.map((row) => {
    // A row whose stored detail does not match the contract reads as an empty detail
    // rather than failing the whole ticket.
    const detail = workOrderEventDetailSchema.safeParse(row.detail);
    if (!detail.success) {
      // The event id and the failing paths only: never the stored value.
      const paths = detail.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
      logger.warn(`Stored work-order event detail does not match its contract: event ${row.id} (${paths})`);
    }
    return {
      id: row.id,
      eventType: row.eventType as WorkOrderEventType,
      actorName: row.actorName,
      fromStatus: row.fromStatus as WorkOrderStatus | null,
      toStatus: row.toStatus as WorkOrderStatus | null,
      detail: detail.success ? detail.data : {},
      createdAt: row.createdAt.toISOString(),
    };
  });

  let alarm: WorkOrderDetail["alarm"] = null;
  if (item.alarmId) {
    const [row] = await tx
      .select({ id: alarms.id, severity: alarms.severity, message: alarms.message, raisedAt: alarms.raisedAt })
      .from(alarms)
      .where(eq(alarms.id, item.alarmId))
      .limit(1);
    alarm = row ? { id: row.id, severity: row.severity, message: row.message, raisedAt: row.raisedAt.toISOString() } : null;
  }

  const tasks = await readWorkOrderTasks(tx, id);

  return { ...item, events, alarm, tasks };
}
