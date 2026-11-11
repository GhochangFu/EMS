import { BadRequestException, ConflictException } from "@nestjs/common";

import { TERMINAL_WORK_ORDER_STATUSES } from "@bms/shared";
import type { WorkOrderStatus } from "@bms/shared";

/**
 * `E3.1` (ADR 0122, plan D9) — the one place that decides whether a work order may make
 * a move. Pure: it takes what the caller read under the row lock and answers a refusal
 * or `null`. `WorkOrdersService`, the two checklist services (through
 * `work-order-task-write.ts`) and the copilot's reorder pre-check ask it; none decides a
 * transition by itself.
 *
 * The D9 table:
 * - `open`, `assigned` and `in_progress` move freely among themselves;
 * - a move into `resolved` is refused (409) while a mandatory checklist item is
 *   `pending` (decision 4.4) — `not_applicable` does not block — and, on a ticket raised
 *   from an alarm, while its root cause is missing (decision 5.2);
 * - a `resolved` ticket goes back to `in_progress` only (ruling P3), which clears its
 *   resolve stamps;
 * - `closed` and `cancelled` are terminal — a status write, an approval, a reject or a cancel
 *   on one is refused (400);
 * - the approval (`POST :id/close`) and the reject take a `resolved` ticket only (409
 *   otherwise, decision 6.5 and ruling P2);
 * - a cancel takes any live or resolved ticket and skips both resolve gates (decision 6.8);
 * - a reorder may not move a card into `resolved` (400, ruling P1), as it already may
 *   not move one into or out of Done;
 * - a checklist write is refused (409) once the ticket is `resolved`, `closed` or
 *   `cancelled`, and a root-cause write once it is `closed` or `cancelled`.
 */

/** A refused move: the HTTP status the route answers and its one fixed sentence. */
export type TransitionRefusal = { readonly status: 400 | 409; readonly message: string };

export const WORK_ORDER_CLOSED_REFUSAL = "Closed work orders cannot be updated";
export const WORK_ORDER_CANCELLED_REFUSAL = "Cancelled work orders cannot be updated";
export const WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL = "Only a resolved work order can be approved and closed";
export const WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL = "Only a resolved work order can be rejected";
export const WORK_ORDER_REOPEN_REFUSAL = "Closed work orders cannot be reopened";
export const WORK_ORDER_CLOSE_BY_DRAG_REFUSAL = "Use the close workflow for Done";
export const WORK_ORDER_CLOSE_BY_STATUS_REFUSAL = "Use the approval to close a work order";
export const WORK_ORDER_CANCEL_BY_STATUS_REFUSAL = "Use the cancel workflow to cancel a work order";
export const WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL = "Use the status workflow for Resolved";
export const WORK_ORDER_MANDATORY_PENDING_REFUSAL =
  "Complete every mandatory checklist item, or mark it not applicable, before resolving";
export const WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL =
  "A work order raised from an alarm needs its root cause, corrective action and cause code before it is resolved";
export const WORK_ORDER_LEAVE_RESOLVED_REFUSAL = "A resolved work order can only go back to In progress";
export const WORK_ORDER_FINDINGS_FROZEN_REFUSAL = "The root cause of a closed or cancelled work order cannot be changed";
export const WORK_ORDER_FINDINGS_KEPT_REFUSAL =
  "A resolved work order raised from an alarm must keep its root cause, corrective action and cause code";
export const WORK_ORDER_TASKS_FROZEN_REFUSAL = "The checklist of a resolved, closed or cancelled work order cannot be changed";

/** The most items one ticket's checklist may hold: the same bound as a template's list. */
export const WORK_ORDER_MAX_TASKS = 100;
export const WORK_ORDER_TASKS_FULL_REFUSAL = `A work order's checklist holds at most ${WORK_ORDER_MAX_TASKS} items`;

const refuse = (status: 400 | 409, message: string): TransitionRefusal => ({ status, message });

/**
 * The two statuses nothing leaves (ADR 0122 decisions 6.1 and 6.8). Every reader of
 * "is this ticket finished for good" asks this, so a seventh status is decided once.
 */
export function isTerminalWorkOrderStatus(status: WorkOrderStatus): boolean {
  return (TERMINAL_WORK_ORDER_STATUSES as readonly WorkOrderStatus[]).includes(status);
}

/** The 400 of any write on a terminal ticket, or `null` for a ticket that is not terminal. */
function terminalRefusal(status: WorkOrderStatus): TransitionRefusal | null {
  if (status === "closed") {
    return refuse(400, WORK_ORDER_CLOSED_REFUSAL);
  }
  if (status === "cancelled") {
    return refuse(400, WORK_ORDER_CANCELLED_REFUSAL);
  }
  return null;
}

/**
 * Whether the resolve gates — the checklist (decision 4.4) and, on an alarm ticket, the
 * root cause (decision 5.2) — decide this move, so the caller reads them only then.
 *
 * Entering `resolved` is the only gated move. A ticket that is already `resolved` passed
 * the gate when it got there, and `closed` is reached only from `resolved` (decision
 * 6.5), so the approval reads neither.
 */
export function needsChecklistGate(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return to === "resolved" && from !== "resolved" && !isTerminalWorkOrderStatus(from);
}

/**
 * `PATCH /work-orders/:id/status`: may the ticket go from `from` to `to`? `to` is one of
 * the four settable statuses; the route's body schema refuses `closed` and `cancelled`
 * (400), and this refuses them too, for any other caller. `pendingMandatory` is the number of mandatory checklist items
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
  const terminal = terminalRefusal(move.from);
  if (terminal !== null) {
    return terminal;
  }
  // Decision 6.5: `closed` is the approval's and `cancelled` is the cancel's.
  if (move.to === "closed") {
    return refuse(400, WORK_ORDER_CLOSE_BY_STATUS_REFUSAL);
  }
  if (move.to === "cancelled") {
    return refuse(400, WORK_ORDER_CANCEL_BY_STATUS_REFUSAL);
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
 * `POST /work-orders/:id/close`, the approval (decision 6.2): only a `resolved` ticket
 * (409 otherwise, ruling P2). The resolve gates are not read again: the ticket passed
 * them when it was resolved, and neither a checklist write nor a clearing root-cause
 * write is accepted while it is `resolved`.
 */
export function approvalRefusal(from: WorkOrderStatus): TransitionRefusal | null {
  return terminalRefusal(from) ?? (from === "resolved" ? null : refuse(409, WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL));
}

/** `POST /work-orders/:id/reject` (decision 6.4): a `resolved` ticket goes back to `in_progress`. */
export function rejectRefusal(from: WorkOrderStatus): TransitionRefusal | null {
  return terminalRefusal(from) ?? (from === "resolved" ? null : refuse(409, WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL));
}

/**
 * `POST /work-orders/:id/cancel` (decision 6.8): from `open`, `assigned`, `in_progress`
 * or `resolved`, with a mandatory item still pending and with no root cause — a
 * cancelled ticket was not done, so neither gate is owed.
 */
export function cancelRefusal(from: WorkOrderStatus): TransitionRefusal | null {
  return terminalRefusal(from);
}

/**
 * Whether this move takes a resolved ticket back to work, which clears `resolved_at`
 * and `resolved_by` (ruling P3): the ticket is not resolved any more, and its SLA clock
 * is running again.
 */
export function clearsResolveStamps(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return from === "resolved" && to === "in_progress";
}

/**
 * Self-approval is allowed and recorded (ruling Q11): true when the approver is the user
 * who resolved the ticket. A ticket resolved before `resolved_by` existed has none, so
 * its approval is never marked (plan risk 5).
 */
export function isSelfApproval(resolvedBy: string | null, approverId: string): boolean {
  return resolvedBy !== null && resolvedBy === approverId;
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
 * replaced? They are frozen at `closed` (decision 5.3) and at `cancelled`, and a resolved alarm ticket must
 * keep the three it resolved with — `missingAfter` is {@link rootCauseMissing} of the
 * findings as the write would leave them.
 */
export function rootCauseWriteRefusal(write: {
  readonly status: WorkOrderStatus;
  readonly hasAlarm: boolean;
  readonly missingAfter: boolean;
}): TransitionRefusal | null {
  if (isTerminalWorkOrderStatus(write.status)) {
    return refuse(409, WORK_ORDER_FINDINGS_FROZEN_REFUSAL);
  }
  if (write.status === "resolved" && write.hasAlarm && write.missingAfter) {
    return refuse(409, WORK_ORDER_FINDINGS_KEPT_REFUSAL);
  }
  return null;
}

/** `PATCH /work-orders/reorder`: may one card of the batch go from `from` to `to`? */
export function reorderMoveRefusal(move: { readonly from: WorkOrderStatus; readonly to: WorkOrderStatus }): TransitionRefusal | null {
  // A cancelled ticket is on no column (decision 6.8): it is never moved, and no card
  // is dragged into it. The body schema refuses `cancelled` as a target first.
  if (move.from === "cancelled" || move.to === "cancelled") {
    return refuse(400, WORK_ORDER_CANCELLED_REFUSAL);
  }
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
  return status === "resolved" || isTerminalWorkOrderStatus(status) ? refuse(409, WORK_ORDER_TASKS_FROZEN_REFUSAL) : null;
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
