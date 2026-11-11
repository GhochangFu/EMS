import { and, eq, inArray, sql } from "drizzle-orm";

import { assets, locations, rtus, workOrders } from "@bms/db";
import { workOrderSlaState } from "@bms/shared";
import type { WorkOrderListItem, WorkOrderPriority, WorkOrderStatus } from "@bms/shared";
import { NotFoundException } from "@nestjs/common";

import type { BmsTx } from "../database/tenant-context";

/**
 * `E3.1` (ADR 0122, plan D3) — the one list projection of a work order.
 *
 * It used to be written three times (the work-order read-back, the work-order list and
 * the maintenance convert read-back), each with its own row type and mapper, so a new
 * column meant three edits and a silent gap when one was missed. The columns, the joins
 * and the mapper now live here, and each of the three callers keeps only its own
 * transaction routing and its own `WHERE`.
 */
export const WORK_ORDER_LIST_COLUMNS = {
  id: workOrders.id,
  reference: workOrders.reference,
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
  slaMinutes: workOrders.slaMinutes,
  slaDueAt: workOrders.slaDueAt,
  // E3.1 (ADR 0122 decision 4): the checklist in two numbers, counted per row so a page
  // of tickets costs no second query. `done` is every item that is no longer `pending`.
  checklistDone: sql<number>`(SELECT count(*)::int FROM bms.work_order_tasks t WHERE t.work_order_id = ${workOrders.id} AND t.result <> 'pending')`,
  checklistTotal: sql<number>`(SELECT count(*)::int FROM bms.work_order_tasks t WHERE t.work_order_id = ${workOrders.id})`,
  causeCode: workOrders.causeCode,
  approvedAt: workOrders.approvedAt,
  createdAt: workOrders.createdAt,
  updatedAt: workOrders.updatedAt,
  assetCode: assets.code,
  assetRtuName: rtus.displayName,
  assetLocationName: locations.name,
  assetName: assets.name,
  siteName: assets.siteName,
} as const;

/** One row of {@link selectWorkOrderList}, before mapping. */
export type WorkOrderListRow = {
  id: string;
  reference: string;
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
  slaMinutes: number | null;
  slaDueAt: Date | null;
  checklistDone: number;
  checklistTotal: number;
  causeCode: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assetCode: string;
  assetRtuName: string | null;
  assetLocationName: string | null;
  assetName: string;
  siteName: string;
};

/** The projection with its three joins; the caller adds `where`, `orderBy` and `limit`. */
export function selectWorkOrderList(tx: BmsTx) {
  return tx
    .select(WORK_ORDER_LIST_COLUMNS)
    .from(workOrders)
    .innerJoin(assets, eq(workOrders.assetId, assets.id))
    .leftJoin(rtus, eq(assets.rtuId, rtus.id))
    .leftJoin(locations, eq(assets.locationId, locations.id));
}

/**
 * A row as the API answers it. `slaState` is computed here, against `now`, and never
 * stored (ADR 0122 decision 3.5).
 */
export function mapWorkOrderRow(r: WorkOrderListRow, now: Date = new Date()): WorkOrderListItem {
  return {
    id: r.id,
    reference: r.reference,
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
    slaMinutes: r.slaMinutes,
    slaDueAt: r.slaDueAt?.toISOString() ?? null,
    slaState: workOrderSlaState({
      slaMinutes: r.slaMinutes,
      slaDueAt: r.slaDueAt,
      // The clock stops at `resolved`. A ticket closed before close was limited to a
      // resolved ticket (ADR 0122 decision 6.5) may never have been resolved; its clock
      // stops at the close, or it would read `breached` for good.
      resolvedAt: r.resolvedAt ?? r.closedAt,
      // Decision 6.8: a cancelled ticket reads `none`.
      cancelled: r.status === "cancelled",
      now,
    }),
    checklistDone: r.checklistDone,
    checklistTotal: r.checklistTotal,
    causeCode: r.causeCode,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    assetCode: r.assetCode,
    assetRtuName: r.assetRtuName,
    assetLocationName: r.assetLocationName,
    assetName: r.assetName,
    siteName: r.siteName,
  };
}

/**
 * One work order by id on the passed transaction, behind the caller's asset scope
 * (`null` or `undefined` is unscoped). 404 when it is absent or out of scope — the two
 * read the same, so a foreign row's existence is not disclosed.
 */
export async function readWorkOrderListItem(
  tx: BmsTx,
  id: string,
  assetIds?: string[] | null,
): Promise<WorkOrderListItem> {
  const [row] = await selectWorkOrderList(tx)
    .where(and(eq(workOrders.id, id), ...(assetIds ? [inArray(workOrders.assetId, assetIds)] : [])))
    .limit(1);
  if (!row) {
    throw new NotFoundException("Work order not found");
  }
  return mapWorkOrderRow(row);
}
