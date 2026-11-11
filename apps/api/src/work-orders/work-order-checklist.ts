import { and, asc, eq, sql } from "drizzle-orm";

import { assets, workOrderChecklistTemplateItems, workOrderChecklistTemplates, workOrderTasks } from "@bms/db";
import type { WorkOrderTaskDto, WorkOrderTaskResult } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `E3.1` (ADR 0122 decision 4) — a ticket's checklist: the reads and the one copy.
 *
 * A ticket's checklist is `bms.work_order_tasks`. Create copies a template's items onto
 * the ticket ONCE ({@link copyChecklistOntoWorkOrder}, called only by `insertWorkOrder`);
 * after that the ticket never reads the template again, so a template edit cannot change
 * an open ticket (decision 4.3).
 *
 * Every function here takes the caller's transaction and reads or writes on it. Inside
 * `withTenant` the `0145` policies bind each statement, and the explicit organization
 * filters below say the same thing in the query.
 */

/** The one sentence for a template that cannot be used, whatever the reason: it names none, so it confirms nothing. */
export const CHECKLIST_TEMPLATE_REFUSAL = "Checklist template not found, retired, or not for this asset's domain";

/**
 * Whether `templateId` can be used for a ticket on `assetId`: it must be a template of
 * the same organization, active, and either for every domain (`domain` NULL) or for the
 * asset's own. A template of another organization reads as absent under the tenant
 * setting, so it answers `false` like a random id.
 *
 * The template row is read `FOR SHARE`, and held to the end of the caller's transaction:
 * the admin edit takes `FOR UPDATE` on the same row, so a retire or an item replacement
 * cannot land between this check and the copy that follows it.
 */
export async function isUsableChecklistTemplate(
  tx: BmsTx,
  input: { readonly organizationId: string; readonly assetId: string; readonly templateId: string },
): Promise<boolean> {
  const [template] = await tx
    .select({ domain: workOrderChecklistTemplates.domain })
    .from(workOrderChecklistTemplates)
    .where(
      and(
        eq(workOrderChecklistTemplates.id, input.templateId),
        eq(workOrderChecklistTemplates.organizationId, input.organizationId),
        eq(workOrderChecklistTemplates.active, true),
      ),
    )
    .limit(1)
    .for("share");
  if (!template) {
    return false;
  }
  if (template.domain === null) {
    return true;
  }
  const [asset] = await tx
    .select({ domain: assets.domain })
    .from(assets)
    .where(and(eq(assets.id, input.assetId), eq(assets.organizationId, input.organizationId)))
    .limit(1);
  return asset?.domain === template.domain;
}

/**
 * Copies a template's items onto a new ticket, in the template's order, and answers how
 * many it copied. `templateItemId` remembers where each task came from; the foreign key
 * sets it NULL when the template's items are replaced later, and the task stays.
 */
export async function copyChecklistOntoWorkOrder(
  tx: BmsTx,
  input: { readonly organizationId: string; readonly workOrderId: string; readonly templateId: string },
): Promise<number> {
  const items = await tx
    .select({
      id: workOrderChecklistTemplateItems.id,
      title: workOrderChecklistTemplateItems.title,
      mandatory: workOrderChecklistTemplateItems.mandatory,
    })
    .from(workOrderChecklistTemplateItems)
    .where(
      and(
        eq(workOrderChecklistTemplateItems.templateId, input.templateId),
        eq(workOrderChecklistTemplateItems.organizationId, input.organizationId),
      ),
    )
    .orderBy(asc(workOrderChecklistTemplateItems.sortOrder), asc(workOrderChecklistTemplateItems.id));
  if (items.length === 0) {
    return 0;
  }
  await tx.insert(workOrderTasks).values(
    items.map((item, index) => ({
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      title: item.title,
      mandatory: item.mandatory,
      // The ticket's own order, 1-based and dense, whatever numbers the template used.
      sortOrder: index + 1,
      templateItemId: item.id,
    })),
  );
  return items.length;
}

/**
 * How many mandatory items of the ticket are still `pending` — what the resolve gate
 * asks (decision 4.4). Call it under the work order's row lock: a checklist write takes
 * the same lock first, so the count cannot change before the status write commits.
 */
export async function countPendingMandatoryTasks(tx: BmsTx, workOrderId: string): Promise<number> {
  const [row] = await tx
    .select({ pending: sql<number>`count(*)::int` })
    .from(workOrderTasks)
    .where(
      and(eq(workOrderTasks.workOrderId, workOrderId), eq(workOrderTasks.mandatory, true), eq(workOrderTasks.result, "pending")),
    );
  return row?.pending ?? 0;
}

const TASK_COLUMNS = {
  id: workOrderTasks.id,
  title: workOrderTasks.title,
  mandatory: workOrderTasks.mandatory,
  result: workOrderTasks.result,
  note: workOrderTasks.note,
  sortOrder: workOrderTasks.sortOrder,
  completedAt: workOrderTasks.completedAt,
  completedBy: workOrderTasks.completedBy,
  templateItemId: workOrderTasks.templateItemId,
} as const;

type TaskRow = {
  id: string;
  title: string;
  mandatory: boolean;
  result: string;
  note: string | null;
  sortOrder: number;
  completedAt: Date | null;
  completedBy: string | null;
  templateItemId: string | null;
};

function mapTaskRow(row: TaskRow): WorkOrderTaskDto {
  return {
    id: row.id,
    title: row.title,
    mandatory: row.mandatory,
    result: row.result as WorkOrderTaskResult,
    note: row.note,
    sortOrder: row.sortOrder,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    templateItemId: row.templateItemId,
  };
}

/** The ticket's checklist in its own order. Empty for a ticket with none. */
export async function readWorkOrderTasks(tx: BmsTx, workOrderId: string): Promise<WorkOrderTaskDto[]> {
  const rows = await tx
    .select(TASK_COLUMNS)
    .from(workOrderTasks)
    .where(eq(workOrderTasks.workOrderId, workOrderId))
    .orderBy(asc(workOrderTasks.sortOrder), asc(workOrderTasks.createdAt), asc(workOrderTasks.id));
  return rows.map(mapTaskRow);
}

/** One item of one ticket, or `null`. The work-order match is part of the read: a task id of another ticket is absent. */
export async function readWorkOrderTask(tx: BmsTx, workOrderId: string, taskId: string): Promise<WorkOrderTaskDto | null> {
  const [row] = await tx
    .select(TASK_COLUMNS)
    .from(workOrderTasks)
    .where(and(eq(workOrderTasks.id, taskId), eq(workOrderTasks.workOrderId, workOrderId)))
    .limit(1);
  return row ? mapTaskRow(row) : null;
}
