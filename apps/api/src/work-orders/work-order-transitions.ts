import { BadRequestException, ConflictException } from "@nestjs/common";

import type { WorkOrderStatus } from "@bms/shared";

/**
 * `E3.1` (ADR 0122, plan D9) — the one place that decides whether a work order may make
 * a move. Pure: it takes what the caller read under the row lock and answers a refusal
 * or `null`. `WorkOrdersService`, the two checklist services (through
 * `work-order-task-write.ts`) and the copilot's reorder pre-check ask it; none decides a
 * transition by itself.
 *
 * PR 3 builds these rows of the D9 table:
 * - `open`, `assigned` and `in_progress` move freely among themselves;
 * - a move into `resolved` is refused (409) while a mandatory checklist item is
 *   `pending` (decision 4.4) — `not_applicable` does not block — and, on a ticket raised
 *   from an alarm, while its root cause is missing (decision 5.2, PR 4);
 * - a `resolved` ticket goes back to `in_progress` only (ruling P3, PR 4), which clears
 *   its resolve stamps;
 * - any status write on a `closed` ticket is refused (400);
 * - a reorder may not move a card into `resolved` (400, ruling P1), as it already may
 *   not move one into or out of Done;
 * - a checklist write is refused (409) once the ticket is `resolved` or `closed`.
 *
 * PR 5 adds approval, reject and cancel here.
 */

/** A refused move: the HTTP status the route answers and its one fixed sentence. */
export type TransitionRefusal = { readonly status: 400 | 409; readonly message: string };

export const WORK_ORDER_CLOSED_REFUSAL = "Closed work orders cannot be updated";
export const WORK_ORDER_REOPEN_REFUSAL = "Closed work orders cannot be reopened";
export const WORK_ORDER_CLOSE_BY_DRAG_REFUSAL = "Use the close workflow for Done";
export const WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL = "Use the status workflow for Resolved";
export const WORK_ORDER_MANDATORY_PENDING_REFUSAL =
  "Complete every mandatory checklist item, or mark it not applicable, before resolving";
export const WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL =
  "A work order raised from an alarm needs its root cause, corrective action and cause code before it is resolved or closed";
export const WORK_ORDER_LEAVE_RESOLVED_REFUSAL = "A resolved work order can only go back to In progress";
export const WORK_ORDER_FINDINGS_FROZEN_REFUSAL = "The root cause of a closed work order cannot be changed";
export const WORK_ORDER_FINDINGS_KEPT_REFUSAL =
  "A resolved work order raised from an alarm must keep its root cause, corrective action and cause code";
export const WORK_ORDER_TASKS_FROZEN_REFUSAL = "The checklist of a resolved or closed work order cannot be changed";

/** The most items one ticket's checklist may hold: the same bound as a template's list. */
export const WORK_ORDER_MAX_TASKS = 100;
export const WORK_ORDER_TASKS_FULL_REFUSAL = `A work order's checklist holds at most ${WORK_ORDER_MAX_TASKS} items`;

const refuse = (status: 400 | 409, message: string): TransitionRefusal => ({ status, message });

/**
 * Whether the resolve gates — the checklist (decision 4.4) and, on an alarm ticket, the
 * root cause (decision 5.2) — decide this move, so the caller reads them only then.
 *
 * Entering `resolved` is the ruled gate. `closed` reached straight from a live status is
 * gated too: until close is limited to a resolved ticket (decision 6.5, PR 5) that path
 * would step around both. A ticket that is already `resolved` passed the gate
 * when it got there.
 */
export function needsChecklistGate(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (from === "resolved" || from === "closed") {
    return false;
  }
  return to === "resolved" || to === "closed";
}

/**
 * `PATCH /work-orders/:id/status` and `POST /work-orders/:id/close`: may the ticket go
 * from `from` to `to`? `pendingMandatory` is the number of mandatory checklist items
 * still `pending`, counted under the row lock, and `rootCauseMissing` is
 * {@link rootCauseMissing} of the findings as this write would leave them; pass 0 and
 * `false` when {@link needsChecklistGate} is false.
 */
export function statusChangeRefusal(move: {
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;
  readonly pendingMandatory: number;
  readonly rootCauseMissing: boolean;
}): TransitionRefusal | null {
  if (move.from === "closed") {
    return refuse(400, WORK_ORDER_CLOSED_REFUSAL);
  }
  // Ruling P3: a resolved ticket goes back to work, not back to the queue.
  if (leavesResolvedForTheQueue(move.from, move.to)) {
    return refuse(409, WORK_ORDER_LEAVE_RESOLVED_REFUSAL);
  }
  if (needsChecklistGate(move.from, move.to)) {
    if (move.pendingMandatory > 0) {
      return refuse(409, WORK_ORDER_MANDATORY_PENDING_REFUSAL);
    }
    if (move.rootCauseMissing) {
      return refuse(409, WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL);
    }
  }
  return null;
}

const leavesResolvedForTheQueue = (from: WorkOrderStatus, to: WorkOrderStatus): boolean =>
  from === "resolved" && (to === "open" || to === "assigned");

/**
 * Whether this move takes a resolved ticket back to work, which clears `resolved_at`
 * and `resolved_by` (ruling P3): the ticket is not resolved any more, and its SLA clock
 * is running again.
 */
export function clearsResolveStamps(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return from === "resolved" && to === "in_progress";
}

const blank = (value: string | null | undefined): boolean => value === null || value === undefined || value.trim() === "";

/**
 * Decision 5.2: a ticket raised from an alarm owes a root cause, a corrective action
 * and a cause code before it may be `resolved`; a planned-maintenance ticket owes none.
 * The alarm's own enrichment snapshot does not count (decision 5a.3).
 */
export function rootCauseMissing(findings: {
  readonly hasAlarm: boolean;
  readonly rootCause: string | null;
  readonly correctiveAction: string | null;
  readonly causeCode: string | null;
}): boolean {
  return findings.hasAlarm && (blank(findings.rootCause) || blank(findings.correctiveAction) || blank(findings.causeCode));
}

/**
 * `PUT /work-orders/:id/root-cause`: may the findings of a ticket in `status` be
 * replaced? They are frozen at `closed` (decision 5.3), and a resolved alarm ticket must
 * keep the three it resolved with — `missingAfter` is {@link rootCauseMissing} of the
 * findings as the write would leave them.
 */
export function rootCauseWriteRefusal(write: {
  readonly status: WorkOrderStatus;
  readonly hasAlarm: boolean;
  readonly missingAfter: boolean;
}): TransitionRefusal | null {
  if (write.status === "closed") {
    return refuse(409, WORK_ORDER_FINDINGS_FROZEN_REFUSAL);
  }
  if (write.status === "resolved" && write.hasAlarm && write.missingAfter) {
    return refuse(409, WORK_ORDER_FINDINGS_KEPT_REFUSAL);
  }
  return null;
}

/** `PATCH /work-orders/reorder`: may one card of the batch go from `from` to `to`? */
export function reorderMoveRefusal(move: { readonly from: WorkOrderStatus; readonly to: WorkOrderStatus }): TransitionRefusal | null {
  if (move.from === "closed" && move.to !== "closed") {
    return refuse(400, WORK_ORDER_REOPEN_REFUSAL);
  }
  if (move.from !== "closed" && move.to === "closed") {
    return refuse(400, WORK_ORDER_CLOSE_BY_DRAG_REFUSAL);
  }
  // Ruling P1: resolve always goes through its form, which carries the checklist gate
  // (and, from PR 4, the root cause). A drag would skip both.
  if (move.from !== "resolved" && move.to === "resolved") {
    return refuse(400, WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL);
  }
  // The same rule as the status route (ruling P3): a drag may take a resolved card back
  // to In progress, and nowhere else.
  if (leavesResolvedForTheQueue(move.from, move.to)) {
    return refuse(409, WORK_ORDER_LEAVE_RESOLVED_REFUSAL);
  }
  return null;
}

/** `POST` and `PATCH /work-orders/:id/tasks`: may the checklist of a ticket in `status` change? */
export function taskWriteRefusal(status: WorkOrderStatus): TransitionRefusal | null {
  return status === "resolved" || status === "closed" ? refuse(409, WORK_ORDER_TASKS_FROZEN_REFUSAL) : null;
}

/** `POST /work-orders/:id/tasks`: may a ticket that already holds `count` items take one more? */
export function taskAddRefusal(count: number): TransitionRefusal | null {
  return count >= WORK_ORDER_MAX_TASKS ? refuse(409, WORK_ORDER_TASKS_FULL_REFUSAL) : null;
}

/** Throws the HTTP error of a refusal; does nothing for `null`. */
export function throwIfRefused(refusal: TransitionRefusal | null): void {
  if (refusal === null) {
    return;
  }
  if (refusal.status === 409) {
    throw new ConflictException(refusal.message);
  }
  throw new BadRequestException(refusal.message);
}
