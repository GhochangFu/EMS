import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { expect } from "vitest";
import type pg from "pg";

import { workOrderDetailSchema, workOrderListItemSchema } from "@bms/shared";
import type { JwtPayload, WorkOrderListItem } from "@bms/shared";

import { createDb } from "@bms/db";

import { RESOLVERS } from "../dashboard-builder/metric-catalog.service";
import type { DashboardService } from "../dashboard/dashboard.service";
import { withTenant } from "../database/tenant-context";
import type { MaintenanceService } from "../maintenance/maintenance.service";
import { WORK_ORDER_APPROVER_UNKNOWN, type WorkOrderApprovalService } from "./work-order-approval.service";
import type { WorkOrderFindingsService } from "./work-order-findings.service";
import type { WorkOrderTaskAddService } from "./work-order-task-add.service";
import {
  WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL,
  WORK_ORDER_CANCELLED_REFUSAL,
  WORK_ORDER_CLOSED_REFUSAL,
  WORK_ORDER_FINDINGS_FROZEN_REFUSAL,
  WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL,
  WORK_ORDER_TASKS_FROZEN_REFUSAL,
} from "./work-order-transitions";
import type { WorkOrdersService } from "./work-orders.service";

/**
 * `E3.1` (ADR 0122 decision 6; plan T5.2) — the approval, the reject and the cancel
 * against real `bms_tenant` and `bms_fleet` roles. Assertions live here;
 * `work-orders.approval.integration.test.ts` owns the database lifecycle (ADR 0014).
 *
 * The role gate (`approval`) is the controller's and is held by
 * `work-orders.controller.spec.ts` and `access-control.integration.spec.ts`; this suite
 * calls the service as a caller the gate let through.
 */
type Actor = Pick<JwtPayload, "sub" | "email">;

export type ApprovalFixtures = {
  svc: WorkOrdersService;
  approval: WorkOrderApprovalService;
  /** The same service with an audit writer that throws, for the atomicity proof. */
  approvalWithFailingAudit: WorkOrderApprovalService;
  findings: WorkOrderFindingsService;
  taskAdd: WorkOrderTaskAddService;
  maintenance: MaintenanceService;
  /** The location dashboard's reader, on the fleet pool, as the API builds it. */
  dashboard: DashboardService;
  tenantPool: pg.Pool;
  fleetPool: pg.Pool;
  /** An `organization_admin` of the organization, and that user's row id: resolves and approves. */
  actor: Actor;
  actorUserId: string;
  /** The global admin, a second approver, and that user's row id. */
  secondApprover: Actor;
  secondApproverUserId: string;
  /** A token with an admin claim and no `bms.users` row. */
  unknownApprover: Actor;
  organizationId: string;
  assetId: string;
  /** A second asset of the same organization, for the scope checks. */
  otherAssetId: string;
  /** A third asset no other assertion files a ticket on, so its open counts are exact. */
  countAssetId: string;
  /** The location the three assets sit in. */
  locationId: string;
  /** An alarm on `assetId`, with no enrichment. */
  alarmId: string;
};

const TITLE = "E3.1 approval fixture";
const REASON = "Checked on site and accepted";
const FULL = { rootCause: "Breaker contacts worn", correctiveAction: "Contacts replaced", causeCode: "wear_and_tear" };

type Row = {
  status: string;
  resolved_at: Date | null;
  resolved_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  closed_at: Date | null;
  cancelled_by: string | null;
  cancelled_at: Date | null;
};

async function rowOf(pool: pg.Pool, id: string): Promise<Row> {
  const { rows } = await pool.query<Row>(
    `SELECT status, resolved_at, resolved_by, approved_by, approved_at, closed_at, cancelled_by, cancelled_at
       FROM bms.work_orders WHERE id = $1`,
    [id],
  );
  if (!rows[0]) throw new Error("E3.1: the ticket is gone");
  return rows[0];
}

type EventRow = { event_type: string; from_status: string | null; to_status: string | null; detail: Record<string, unknown>; actor_id: string | null };

async function eventsOf(pool: pg.Pool, id: string): Promise<EventRow[]> {
  const { rows } = await pool.query<EventRow>(
    "SELECT event_type, from_status, to_status, detail, actor_id FROM bms.work_order_events WHERE work_order_id = $1 ORDER BY created_at, id",
    [id],
  );
  return rows;
}

async function auditsOf(pool: pg.Pool, id: string, action: string): Promise<Array<{ reason: string | null; payload: Record<string, unknown> }>> {
  const { rows } = await pool.query<{ reason: string | null; payload: Record<string, unknown> }>(
    "SELECT reason, payload FROM bms.audit_log WHERE entity_type = 'work_order' AND entity_id = $1 AND action = $2 ORDER BY created_at",
    [id, action],
  );
  return rows;
}

const planned = (ctx: ApprovalFixtures, extra: { slaMinutes?: number } = {}) =>
  ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low", ...extra }, ctx.actor, null);
const fromAlarm = (ctx: ApprovalFixtures) =>
  ctx.svc.create({ assetId: ctx.assetId, alarmId: ctx.alarmId, title: TITLE, priority: "high" }, ctx.actor, null);

/** A planned ticket, resolved by the organization admin. */
async function resolved(ctx: ApprovalFixtures): Promise<WorkOrderListItem> {
  const created = await planned(ctx);
  return ctx.svc.updateStatus(created.id, { status: "resolved" }, ctx.actor, null);
}

/** Decision 6.5, ruling P2: the approval takes a `resolved` ticket only — 409 from each live status, and nothing is written. */
export async function assertCloseFromALiveStatusIs409AndWritesNothing(ctx: ApprovalFixtures): Promise<void> {
  for (const status of ["open", "assigned", "in_progress"] as const) {
    const created = await planned(ctx);
    if (status !== "open") {
      await ctx.svc.updateStatus(created.id, { status }, ctx.actor, null);
    }
    const before = await eventsOf(ctx.fleetPool, created.id);

    const attempt = ctx.approval.approve(created.id, { reason: REASON }, ctx.actor, null);
    await expect(attempt, status).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt, status).rejects.toThrow(WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL);

    const row = await rowOf(ctx.fleetPool, created.id);
    expect([row.status, row.approved_by, row.approved_at, row.closed_at], status).toEqual([status, null, null, null]);
    expect(await eventsOf(ctx.fleetPool, created.id), `${status}: no event`).toEqual(before);
    expect(await auditsOf(ctx.fleetPool, created.id, "work_order_approve"), `${status}: no audit row`).toEqual([]);
  }
}

/**
 * Ruling Q11: the resolver may approve their own ticket, and it is recorded — the
 * `approved` event's detail and the audit payload both carry `selfApproved: true`.
 */
export async function assertSelfApprovalIsAllowedAndRecorded(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);

  const closed = await ctx.approval.approve(ticket.id, { reason: REASON, sortOrder: 4000 }, ctx.actor, null);
  expect(workOrderListItemSchema.safeParse(closed).success, "the answer is a list item").toBe(true);
  expect([closed.status, closed.sortOrder, closed.approvedAt !== null, closed.closedAt !== null]).toEqual(["closed", 4000, true, true]);

  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.approved_by, row.resolved_by]).toEqual(["closed", ctx.actorUserId, ctx.actorUserId]);
  expect(row.approved_at).toEqual(row.closed_at);
  expect(row.resolved_at, "the resolve stamp stays").not.toBeNull();

  const last = (await eventsOf(ctx.fleetPool, ticket.id)).at(-1);
  expect(last).toEqual({
    event_type: "approved",
    from_status: "resolved",
    to_status: "closed",
    detail: { reason: REASON, selfApproved: true },
    actor_id: ctx.actorUserId,
  });

  const [audit] = await auditsOf(ctx.fleetPool, ticket.id, "work_order_approve");
  expect(audit?.reason).toBe(REASON);
  expect(audit?.payload).toMatchObject({ reference: ticket.reference, fromStatus: "resolved", toStatus: "closed", selfApproved: true });
}

/** An approval by someone other than the resolver carries no `selfApproved` key, on the event or the audit row. */
export async function assertASecondApproverIsNotSelfApproved(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.secondApprover, null);

  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.approved_by, row.resolved_by]).toEqual(["closed", ctx.secondApproverUserId, ctx.actorUserId]);
  const last = (await eventsOf(ctx.fleetPool, ticket.id)).at(-1);
  expect(last?.detail, "no selfApproved key at all").toEqual({ reason: REASON });
  expect(last?.actor_id).toBe(ctx.secondApproverUserId);
  const [audit] = await auditsOf(ctx.fleetPool, ticket.id, "work_order_approve");
  expect(audit?.payload).not.toHaveProperty("selfApproved");
}

/** A ticket resolved before `resolved_by` existed has no recorded resolver: its approval is never marked self-approved (plan risk 5). */
export async function assertATicketWithNoRecordedResolverIsNeverSelfApproved(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  await ctx.fleetPool.query("UPDATE bms.work_orders SET resolved_by = NULL WHERE id = $1", [ticket.id]);
  await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.actor, null);
  expect((await eventsOf(ctx.fleetPool, ticket.id)).at(-1)?.detail).toEqual({ reason: REASON });
}

/** Decision 6.4: a reject sends a `resolved` ticket back to `in_progress`, clears both resolve stamps and records the reason. */
export async function assertRejectSendsAResolvedTicketBackToWork(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  const rejected = await ctx.approval.reject(ticket.id, { reason: "The seal still leaks" }, ctx.secondApprover, null);
  expect([rejected.status, rejected.resolvedAt]).toEqual(["in_progress", null]);

  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.resolved_at, row.resolved_by, row.approved_by]).toEqual(["in_progress", null, null, null]);
  expect((await eventsOf(ctx.fleetPool, ticket.id)).at(-1)).toEqual({
    event_type: "rejected",
    from_status: "resolved",
    to_status: "in_progress",
    detail: { reason: "The seal still leaks" },
    actor_id: ctx.secondApproverUserId,
  });
  const [audit] = await auditsOf(ctx.fleetPool, ticket.id, "work_order_reject");
  expect(audit?.reason).toBe("The seal still leaks");
  expect(audit?.payload).toMatchObject({ reference: ticket.reference, fromStatus: "resolved", toStatus: "in_progress" });

  // The technician resolves it again, and it can then be approved.
  await ctx.svc.updateStatus(ticket.id, { status: "resolved" }, ctx.actor, null);
  expect((await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.secondApprover, null)).status).toBe("closed");
}

/** A reject of a ticket that is not `resolved` answers 409 and writes nothing. */
export async function assertRejectOfAnUnresolvedTicketIs409(ctx: ApprovalFixtures): Promise<void> {
  const created = await planned(ctx);
  const attempt = ctx.approval.reject(created.id, { reason: "Nothing to reject" }, ctx.actor, null);
  await expect(attempt).rejects.toBeInstanceOf(ConflictException);
  await expect(attempt).rejects.toThrow(WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL);
  expect((await rowOf(ctx.fleetPool, created.id)).status).toBe("open");
  expect((await eventsOf(ctx.fleetPool, created.id)).map((row) => row.event_type)).toEqual(["created"]);
}

/**
 * Decision 6.8: a cancel from each of the four live statuses gives `cancelled`,
 * `cancelled_by`, `cancelled_at` and a `cancelled` event with the reason — with a
 * mandatory checklist item still pending and, on an alarm ticket, with no root cause.
 */
export async function assertCancelFromEachLiveStatusSkipsBothGates(ctx: ApprovalFixtures): Promise<void> {
  for (const status of ["open", "assigned", "in_progress"] as const) {
    // An alarm ticket with no findings and a mandatory item nobody ticked: it could not be resolved.
    const created = await fromAlarm(ctx);
    await ctx.taskAdd.addTask(created.id, { title: "Isolate the feeder", mandatory: true }, ctx.actor, null);
    if (status !== "open") {
      await ctx.svc.updateStatus(created.id, { status }, ctx.actor, null);
    }
    const cancelled = await ctx.approval.cancel(created.id, { reason: "Raised by mistake" }, ctx.actor, null);
    expect([cancelled.status, cancelled.checklistDone, cancelled.checklistTotal, cancelled.causeCode], status).toEqual(["cancelled", 0, 1, null]);

    const row = await rowOf(ctx.fleetPool, created.id);
    expect([row.status, row.cancelled_by, row.cancelled_at !== null, row.closed_at, row.approved_by], status).toEqual([
      "cancelled",
      ctx.actorUserId,
      true,
      null,
      null,
    ]);
    expect((await eventsOf(ctx.fleetPool, created.id)).at(-1), status).toEqual({
      event_type: "cancelled",
      from_status: status,
      to_status: "cancelled",
      detail: { reason: "Raised by mistake" },
      actor_id: ctx.actorUserId,
    });
    const [audit] = await auditsOf(ctx.fleetPool, created.id, "work_order_cancel");
    expect(audit?.reason, status).toBe("Raised by mistake");
    expect(audit?.payload, status).toMatchObject({ reference: created.reference, fromStatus: status, toStatus: "cancelled" });
  }

  // From `resolved`: the resolve stamps stay as history.
  const ticket = await resolved(ctx);
  expect((await ctx.approval.cancel(ticket.id, { reason: "Superseded by another ticket" }, ctx.secondApprover, null)).status).toBe("cancelled");
  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.cancelled_by, row.resolved_by, row.resolved_at !== null]).toEqual([
    "cancelled",
    ctx.secondApproverUserId,
    ctx.actorUserId,
    true,
  ]);
}

/** Decision 6.8: a cancelled ticket reads SLA state `none`, whatever it read before, in the list and in the detail. */
export async function assertACancelledTicketReadsSlaNone(ctx: ApprovalFixtures): Promise<void> {
  const created = await planned(ctx, { slaMinutes: 60 });
  expect(created.slaState).toBe("on_track");
  const cancelled = await ctx.approval.cancel(created.id, { reason: "Raised by mistake" }, ctx.actor, null);
  expect([cancelled.slaState, cancelled.slaMinutes]).toEqual(["none", 60]);

  // A resolved ticket read `met`; cancelled, it reads `none` too.
  const done = await ctx.svc.create({ assetId: ctx.assetId, title: TITLE, priority: "low", slaMinutes: 60 }, ctx.actor, null);
  expect((await ctx.svc.updateStatus(done.id, { status: "resolved" }, ctx.actor, null)).slaState).toBe("met");
  await ctx.approval.cancel(done.id, { reason: "Raised by mistake" }, ctx.actor, null);
  const detail = await ctx.svc.getDetail(done.id, null);
  expect(workOrderDetailSchema.safeParse(detail).success, "the detail matches its contract").toBe(true);
  expect([detail.status, detail.slaState]).toEqual(["cancelled", "none"]);
  expect([detail.cancelledBy, detail.cancelledAt !== null, detail.approvedBy]).toEqual([ctx.actorUserId, true, null]);
}

/** The detail read names who approved a closed ticket. */
export async function assertTheDetailNamesTheApprover(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.secondApprover, null);
  const detail = await ctx.svc.getDetail(ticket.id, null);
  expect(workOrderDetailSchema.safeParse(detail).success).toBe(true);
  expect([detail.approvedBy, detail.resolvedBy, detail.cancelledBy, detail.cancelledAt]).toEqual([
    ctx.secondApproverUserId,
    ctx.actorUserId,
    null,
    null,
  ]);
  expect(detail.events.at(-1)?.eventType).toBe("approved");
}

/**
 * A cancelled ticket is terminal: the status route, the approval, the reject, a second
 * cancel and a reorder each answer 400; the checklist and the root cause answer 409.
 * Nothing changes and no event is added.
 */
export async function assertACancelledTicketRefusesEveryWrite(ctx: ApprovalFixtures): Promise<void> {
  const created = await planned(ctx);
  await ctx.approval.cancel(created.id, { reason: "Raised by mistake" }, ctx.actor, null);
  const before = await eventsOf(ctx.fleetPool, created.id);

  const bad = async (attempt: Promise<unknown>, label: string): Promise<void> => {
    await expect(attempt, label).rejects.toBeInstanceOf(BadRequestException);
    await expect(attempt, label).rejects.toThrow(WORK_ORDER_CANCELLED_REFUSAL);
  };
  await bad(ctx.svc.updateStatus(created.id, { status: "in_progress" }, ctx.actor, null), "status");
  await bad(ctx.approval.approve(created.id, { reason: REASON }, ctx.actor, null), "approve");
  await bad(ctx.approval.reject(created.id, { reason: REASON }, ctx.actor, null), "reject");
  await bad(ctx.approval.cancel(created.id, { reason: REASON }, ctx.actor, null), "cancel again");
  await bad(ctx.svc.reorder({ items: [{ id: created.id, status: "open", sortOrder: 0 }] }, ctx.actor, null), "reorder");

  const task = ctx.taskAdd.addTask(created.id, { title: "Too late", mandatory: false }, ctx.actor, null);
  await expect(task).rejects.toBeInstanceOf(ConflictException);
  await expect(task).rejects.toThrow(WORK_ORDER_TASKS_FROZEN_REFUSAL);
  const rootCause = ctx.findings.putRootCause(created.id, FULL, ctx.actor, null);
  await expect(rootCause).rejects.toBeInstanceOf(ConflictException);
  await expect(rootCause).rejects.toThrow(WORK_ORDER_FINDINGS_FROZEN_REFUSAL);

  expect((await rowOf(ctx.fleetPool, created.id)).status).toBe("cancelled");
  expect(await eventsOf(ctx.fleetPool, created.id), "no event was added").toEqual(before);
}

/** A closed ticket refuses a second approval, a reject and a cancel with 400. */
export async function assertAClosedTicketRefusesApprovalRejectAndCancel(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.actor, null);
  for (const [label, attempt] of [
    ["approve", () => ctx.approval.approve(ticket.id, { reason: REASON }, ctx.actor, null)],
    ["reject", () => ctx.approval.reject(ticket.id, { reason: REASON }, ctx.actor, null)],
    ["cancel", () => ctx.approval.cancel(ticket.id, { reason: REASON }, ctx.actor, null)],
  ] as const) {
    const refused = attempt();
    await expect(refused, label).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused, label).rejects.toThrow(WORK_ORDER_CLOSED_REFUSAL);
  }
  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.cancelled_by, row.cancelled_at]).toEqual(["closed", null, null]);
}

/** A caller with no `bms.users` row cannot be stamped as the approver: all three writes are refused (403) and nothing changes. */
export async function assertAnApproverWithNoUserRowIsRefused(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  for (const [label, attempt] of [
    ["approve", () => ctx.approval.approve(ticket.id, { reason: REASON }, ctx.unknownApprover, null)],
    ["reject", () => ctx.approval.reject(ticket.id, { reason: REASON }, ctx.unknownApprover, null)],
    ["cancel", () => ctx.approval.cancel(ticket.id, { reason: REASON }, ctx.unknownApprover, null)],
  ] as const) {
    const refused = attempt();
    await expect(refused, label).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refused, label).rejects.toThrow(WORK_ORDER_APPROVER_UNKNOWN);
  }
  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.approved_by, row.cancelled_by]).toEqual(["resolved", null, null]);
}

/** A ticket outside the caller's asset scope answers 404 on all three writes, the same as one that does not exist. */
export async function assertAnApprovalOutsideTheScopeIsNotFound(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  for (const scope of [[ctx.otherAssetId], []]) {
    await expect(ctx.approval.approve(ticket.id, { reason: REASON }, ctx.actor, scope)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.approval.reject(ticket.id, { reason: REASON }, ctx.actor, scope)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctx.approval.cancel(ticket.id, { reason: REASON }, ctx.actor, scope)).rejects.toBeInstanceOf(NotFoundException);
  }
  expect((await rowOf(ctx.fleetPool, ticket.id)).status).toBe("resolved");
  // Inside the scope it is approved.
  expect((await ctx.approval.approve(ticket.id, { reason: REASON }, ctx.actor, [ctx.assetId])).status).toBe("closed");
}

/** The write, the audit row and the event are one transaction: an audit failure leaves the ticket as it was, with no event. */
export async function assertAFailedAuditLeavesNoApproval(ctx: ApprovalFixtures): Promise<void> {
  const ticket = await resolved(ctx);
  const before = await eventsOf(ctx.fleetPool, ticket.id);
  await expect(ctx.approvalWithFailingAudit.approve(ticket.id, { reason: REASON }, ctx.actor, null)).rejects.toThrow("audit is down");
  await expect(ctx.approvalWithFailingAudit.reject(ticket.id, { reason: REASON }, ctx.actor, null)).rejects.toThrow("audit is down");
  await expect(ctx.approvalWithFailingAudit.cancel(ticket.id, { reason: REASON }, ctx.actor, null)).rejects.toThrow("audit is down");
  const row = await rowOf(ctx.fleetPool, ticket.id);
  expect([row.status, row.approved_by, row.cancelled_by, row.resolved_by]).toEqual(["resolved", null, null, ctx.actorUserId]);
  expect(await eventsOf(ctx.fleetPool, ticket.id)).toEqual(before);
}

const scheduleBody = (ctx: ApprovalFixtures, title: string) => ({
  assetId: ctx.assetId,
  title,
  category: "preventive" as const,
  generationMode: "calendar" as const,
  safetyCritical: false,
  priority: "medium" as const,
  estimatedMinutes: 60,
  intervalDays: 30,
  firstDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
});

/**
 * Plan D20: a schedule whose only work order is cancelled converts again, as it does
 * after a close. While that work order is live — `resolved` included — it does not.
 */
export async function assertACancelledWorkOrderFreesItsSchedule(ctx: ApprovalFixtures): Promise<void> {
  const schedule = await ctx.maintenance.createSchedule(scheduleBody(ctx, "E3.1 schedule, cancelled work order"), ctx.actor, null);
  const first = await ctx.maintenance.convertToWorkOrder(schedule.id, {}, ctx.actor, null);

  await ctx.svc.updateStatus(first.workOrder.id, { status: "resolved" }, ctx.actor, null);
  await expect(ctx.maintenance.convertToWorkOrder(schedule.id, {}, ctx.actor, null), "a resolved work order is still active").rejects.toThrow(
    "This maintenance item already has an active work order",
  );

  await ctx.approval.cancel(first.workOrder.id, { reason: "Planned shutdown was moved" }, ctx.actor, null);
  const second = await ctx.maintenance.convertToWorkOrder(schedule.id, {}, ctx.actor, null);
  expect(second.workOrder.id).not.toBe(first.workOrder.id);
  expect(second.workOrder.status).toBe("open");
}

/** The list reads cancelled tickets, and the status filter the copilot's list tool uses takes `cancelled`. */
export async function assertTheListReadsCancelledTickets(ctx: ApprovalFixtures): Promise<void> {
  const created = await planned(ctx);
  await ctx.approval.cancel(created.id, { reason: "Raised by mistake" }, ctx.actor, null);
  const { items } = await ctx.svc.list({ limit: 100, assetIds: [ctx.assetId] }, { status: "cancelled" });
  expect(items.length).toBeGreaterThan(0);
  expect(new Set(items.map((item) => item.status))).toEqual(new Set(["cancelled"]));
  expect(items.map((item) => item.id)).toContain(created.id);
}

/** The two work-order resolvers read `tx`, the organization and the scope only. */
const NO_DEPS = {} as Parameters<(typeof RESOLVERS)["workorders.open.count"]>[3];

/**
 * Plan D20, risk 6: a cancelled ticket is not outstanding work. The location dashboard's
 * two open counts (everything but `closed` and `cancelled`) and the metric catalog's
 * (also not `resolved`) each leave it out — a `<> 'closed'` left behind would count it
 * for good, and nothing else would show it.
 */
export async function assertTheOpenCountsLeaveACancelledTicketOut(ctx: ApprovalFixtures): Promise<void> {
  const on = (title: string) => ctx.svc.create({ assetId: ctx.countAssetId, title, priority: "low" }, ctx.actor, null);
  await on("E3.1 count: open");
  const toResolve = await on("E3.1 count: resolved");
  await ctx.svc.updateStatus(toResolve.id, { status: "resolved" }, ctx.actor, null);
  const toClose = await on("E3.1 count: closed");
  await ctx.svc.updateStatus(toClose.id, { status: "resolved" }, ctx.actor, null);
  await ctx.approval.approve(toClose.id, { reason: REASON }, ctx.actor, null);
  const toCancel = await on("E3.1 count: cancelled");
  await ctx.approval.cancel(toCancel.id, { reason: "Raised by mistake" }, ctx.actor, null);

  const scope = [ctx.countAssetId];
  const dashboard = await ctx.dashboard.locationDashboard(ctx.locationId, { assetIds: scope });
  expect(dashboard, "the fixture location has a dashboard").not.toBeNull();
  expect(dashboard?.assets.items.map((asset) => [asset.id, asset.openWorkOrderCount]), "the asset row: open and resolved").toEqual([
    [ctx.countAssetId, 2],
  ]);
  expect(dashboard?.workOrdersOpen, "the location total: open and resolved").toBe(2);

  const metric = await withTenant(createDb(ctx.tenantPool), ctx.organizationId, (tx) =>
    RESOLVERS["workorders.open.count"](tx, ctx.organizationId, scope, NO_DEPS, undefined, null),
  );
  expect(metric).toMatchObject({ key: "workorders.open.count", value: 1 });
  const dataset = await withTenant(createDb(ctx.tenantPool), ctx.organizationId, (tx) =>
    RESOLVERS["workorders.open"](tx, ctx.organizationId, scope, NO_DEPS, undefined, null),
  );
  expect(JSON.stringify(dataset)).toContain("E3.1 count: open");
  expect(JSON.stringify(dataset)).not.toContain("E3.1 count: cancelled");
}
