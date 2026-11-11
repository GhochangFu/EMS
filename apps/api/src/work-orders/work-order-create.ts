import { and, eq, sql } from "drizzle-orm";

import { allocateWorkOrderReference, workOrderSlaPolicies, workOrders } from "@bms/db";
import { WORK_ORDER_SLA_DEFAULT_MINUTES } from "@bms/shared";
import type { WorkOrderOrigin, WorkOrderPriority } from "@bms/shared";
import { BadRequestException } from "@nestjs/common";

import type { BmsTx } from "../database/tenant-context";
import { type WorkOrderActor, writeWorkOrderEvent } from "./work-order-events";

/**
 * `E3.1` (ADR 0122, plan D3) — the one place a work order row is inserted.
 *
 * Two routes create a work order: `POST /work-orders` and the maintenance convert. Both
 * call this, inside their own tenant transaction, so everything a new ticket must carry
 * is decided once: its reference (decision 2), its SLA snapshot (decision 3) and its
 * first timeline events (decision 7). Later PRs add the checklist copy and the alarm
 * snapshot here too.
 *
 * Do not insert into `bms.work_orders` anywhere else in `apps/api`:
 * `tests/e3.1-work-order-write-gates.test.ts` holds that line.
 */
export type InsertWorkOrderInput = {
  readonly organizationId: string;
  readonly assetId: string;
  readonly alarmId?: string | null;
  readonly title: string;
  readonly description?: string | null;
  readonly status: "open" | "assigned";
  readonly priority: WorkOrderPriority;
  readonly assignedTo?: string | null;
  /** Who is creating it: `createdBy` and the name on the `created` event. */
  readonly actor: WorkOrderActor;
  /** How it came to exist; the timeline's first event records it (decision 8). */
  readonly origin: WorkOrderOrigin;
  readonly dueAt?: Date | null;
  /** The create body's override; wins over the organization's policy (decision 3.2). */
  readonly slaMinutes?: number;
};

/** Where a ticket's SLA minutes came from; recorded in the create audit row. */
export type WorkOrderSlaSource = "override" | "organization" | "default";

export type InsertedWorkOrder = {
  readonly id: string;
  readonly reference: string;
  readonly slaMinutes: number;
  readonly slaSource: WorkOrderSlaSource;
};

/**
 * The SLA a new ticket of this priority gets: the body's override, else the
 * organization's policy row, else the platform default. Read inside the tenant
 * transaction, so the `0140` policy on `bms.work_order_sla_policies` backs the explicit
 * organization filter.
 */
export async function resolveSlaMinutes(
  tx: BmsTx,
  organizationId: string,
  priority: WorkOrderPriority,
  override?: number,
): Promise<{ minutes: number; source: WorkOrderSlaSource }> {
  if (override !== undefined) {
    return { minutes: override, source: "override" };
  }
  const [policy] = await tx
    .select({ resolutionMinutes: workOrderSlaPolicies.resolutionMinutes })
    .from(workOrderSlaPolicies)
    .where(and(eq(workOrderSlaPolicies.organizationId, organizationId), eq(workOrderSlaPolicies.priority, priority)))
    .limit(1);
  return policy
    ? { minutes: policy.resolutionMinutes, source: "organization" }
    : { minutes: WORK_ORDER_SLA_DEFAULT_MINUTES[priority], source: "default" };
}

/**
 * Inserts one work order with its reference and SLA snapshot. Call it inside the tenant
 * transaction of the write; see the module comment for why it is the only insert.
 */
export async function insertWorkOrder(tx: BmsTx, input: InsertWorkOrderInput): Promise<InsertedWorkOrder> {
  const { minutes: slaMinutes, source: slaSource } = await resolveSlaMinutes(
    tx,
    input.organizationId,
    input.priority,
    input.slaMinutes,
  );
  const { seq, reference } = await allocateWorkOrderReference(tx, input.organizationId, input.assetId);

  const [created] = await tx
    .insert(workOrders)
    .values({
      organizationId: input.organizationId,
      seq,
      reference,
      assetId: input.assetId,
      alarmId: input.alarmId ?? undefined,
      title: input.title,
      description: input.description ?? undefined,
      status: input.status,
      priority: input.priority,
      assignedTo: input.assignedTo ?? undefined,
      createdBy: input.actor.id,
      dueAt: input.dueAt ?? null,
      slaMinutes,
      // `now()` is the transaction's start time, the same instant `created_at` defaults
      // to, so `sla_due_at - created_at` is exactly the minutes.
      createdAt: sql`now()`,
      slaDueAt: sql`now() + make_interval(mins => ${slaMinutes}::integer)`,
    })
    .returning({ id: workOrders.id });
  if (!created) {
    throw new BadRequestException("Could not create work order");
  }

  // The timeline starts here, in the same transaction as the row (decision 7.3).
  const event = { organizationId: input.organizationId, workOrderId: created.id, actor: input.actor };
  await writeWorkOrderEvent(tx, {
    ...event,
    eventType: "created",
    toStatus: "open",
    detail: { origin: input.origin },
  });
  if (input.assignedTo) {
    // A ticket created with an assignee is `assigned` at once; the stepper needs the moment.
    await writeWorkOrderEvent(tx, {
      ...event,
      eventType: "assigned",
      fromStatus: "open",
      toStatus: "assigned",
      detail: { assignedTo: input.assignedTo },
    });
  }
  return { id: created.id, reference, slaMinutes, slaSource };
}
