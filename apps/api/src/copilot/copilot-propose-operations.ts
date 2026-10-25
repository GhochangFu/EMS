import type { CatalogEntry } from "@bms/shared/copilot";

import type { ResolvedTarget } from "./copilot-target-resolver";
import { PROPOSE_TARGET_ERROR } from "./copilot-template-lifecycle";

/**
 * `F4.284` (ADR 0106 decisions 2 and 3; owner rulings DC2, DC6, 2026-10-24) — the
 * propose step's checks for the alarm and work-order entries and the maintenance
 * convert. Pure: they read only the body and what the target resolver read
 * (`copilot-operations-targets.ts`), so they never touch the database.
 *
 * DC6: a change the route would refuse is refused here with the route's own
 * sentence, so no card is shown that could never apply. A target that carries
 * none of the state a check needs fails closed (`PROPOSE_TARGET_ERROR`).
 *
 * DC2: a reorder's card lists every work order whose status or position moves,
 * old and new, as the card-only `moves` (stored beside the body, left out of the
 * hash by the entry's `cardOnly`).
 */
export const OPERATIONS_ENTRY_IDS: ReadonlySet<string> = new Set([
  "alarm.acknowledge",
  "alarm.enrichment.set",
  "workOrder.create",
  "workOrder.setStatus",
  "workOrder.close",
  "workOrder.reorder",
  "maintenanceSchedule.convert",
]);

/** The routes' own sentences (`alarms.service.ts`, `work-orders.service.ts`, `maintenance.service.ts`). */
export const ALARM_ALREADY_ACKNOWLEDGED = "Alarm not found or already acknowledged";
export const WORK_ORDER_CLOSED = "Closed work orders cannot be updated";
export const WORK_ORDER_REOPEN = "Closed work orders cannot be reopened";
export const WORK_ORDER_CLOSE_BY_DRAG = "Use the close workflow for Done";
export const WORK_ORDER_DUPLICATE = "Duplicate work order ids in reorder request";
export const SCHEDULE_NOT_CONVERTIBLE = "Maintenance schedule not found";
export const SCHEDULE_HAS_WORK_ORDER = "This maintenance item already has an active work order";

/** One moved work order on a reorder card. */
export type WorkOrderMove = {
  readonly id: string;
  readonly title: string;
  readonly fromStatus: string;
  readonly fromSortOrder: number;
  readonly toStatus: string;
  readonly toSortOrder: number;
};

export type OperationsCheck = { ok: true; cardBody: Record<string, unknown> } | { ok: false; error: string };

const refuse = (error: string): OperationsCheck => ({ ok: false, error });
const NOTHING: OperationsCheck = { ok: true, cardBody: {} };

type ReorderItem = { id: string; status: string; sortOrder: number };

function reorderItems(body: Readonly<Record<string, unknown>>): ReorderItem[] {
  return Array.isArray(body.items) ? (body.items as ReorderItem[]) : [];
}

/** DC6 and DC2 for a reorder: the route's refusals per item, then the moves the card lists. */
function checkReorder(body: Readonly<Record<string, unknown>>, target: ResolvedTarget): OperationsCheck {
  const items = reorderItems(body);
  if (new Set(items.map((item) => item.id)).size !== items.length) return refuse(WORK_ORDER_DUPLICATE);
  if (target.batch === undefined) return refuse(PROPOSE_TARGET_ERROR);
  const now = new Map(target.batch.map((row) => [row.id, row]));
  const moves: WorkOrderMove[] = [];
  for (const item of items) {
    const current = now.get(item.id);
    if (current === undefined) return refuse(PROPOSE_TARGET_ERROR);
    if (current.status === "closed" && item.status !== "closed") return refuse(WORK_ORDER_REOPEN);
    if (current.status !== "closed" && item.status === "closed") return refuse(WORK_ORDER_CLOSE_BY_DRAG);
    if (current.status === item.status && current.sortOrder === item.sortOrder) continue;
    moves.push({
      id: item.id,
      title: current.title,
      fromStatus: current.status,
      fromSortOrder: current.sortOrder,
      toStatus: item.status,
      toSortOrder: item.sortOrder,
    });
  }
  return { ok: true, cardBody: { moves } };
}

/** The checks for one entry; an entry this file does not name passes with no card-only keys. */
export function checkOperations(entry: CatalogEntry, body: Readonly<Record<string, unknown>>, target: ResolvedTarget): OperationsCheck {
  switch (entry.id) {
    case "alarm.acknowledge":
      if (target.alarm === undefined) return refuse(PROPOSE_TARGET_ERROR);
      return target.alarm.acknowledgedAt === null ? NOTHING : refuse(ALARM_ALREADY_ACKNOWLEDGED);
    case "alarm.enrichment.set":
      return target.alarm === undefined ? refuse(PROPOSE_TARGET_ERROR) : NOTHING;
    case "workOrder.setStatus":
    case "workOrder.close":
      if (target.workOrder === undefined) return refuse(PROPOSE_TARGET_ERROR);
      return target.workOrder.status === "closed" ? refuse(WORK_ORDER_CLOSED) : NOTHING;
    case "workOrder.reorder":
      return checkReorder(body, target);
    case "maintenanceSchedule.convert":
      if (target.convertible === undefined) return refuse(PROPOSE_TARGET_ERROR);
      if (!target.convertible.active) return refuse(SCHEDULE_NOT_CONVERTIBLE);
      return target.convertible.hasActiveWorkOrder ? refuse(SCHEDULE_HAS_WORK_ORDER) : NOTHING;
    default:
      return NOTHING;
  }
}

/** The summary input the operations entries read: the alarm (decision 3) and the work order. */
export function operationsSummaryInput(target: ResolvedTarget): {
  alarm?: { message: string; severity: string; assetName: string; raisedAt: string };
  workOrder?: { title: string; status: string; assetName: string };
} {
  return {
    ...(target.alarm
      ? {
          alarm: {
            message: target.alarm.message,
            severity: target.alarm.severity,
            assetName: target.alarm.assetName,
            raisedAt: target.alarm.raisedAt,
          },
        }
      : {}),
    ...(target.workOrder ? { workOrder: { ...target.workOrder } } : {}),
  };
}
