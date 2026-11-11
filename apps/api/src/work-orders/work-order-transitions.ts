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
 *   `pending` (decision 4.4) — `not_applicable` does not block;
 * - any status write on a `closed` ticket is refused (400);
 * - a reorder may not move a card into `resolved` (400, ruling P1), as it already may
 *   not move one into or out of Done;
 * - a checklist write is refused (409) once the ticket is `resolved` or `closed`.
 *
 * Later PRs add the root-cause gate (PR 4) and approval, reject and cancel (PR 5) here.
 */

/** A refused move: the HTTP status the route answers and its one fixed sentence. */
export type TransitionRefusal = { readonly status: 400 | 409; readonly message: string };

export const WORK_ORDER_CLOSED_REFUSAL = "Closed work orders cannot be updated";
export const WORK_ORDER_REOPEN_REFUSAL = "Closed work orders cannot be reopened";
export const WORK_ORDER_CLOSE_BY_DRAG_REFUSAL = "Use the close workflow for Done";
export const WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL = "Use the status workflow for Resolved";
export const WORK_ORDER_MANDATORY_PENDING_REFUSAL =
  "Complete every mandatory checklist item, or mark it not applicable, before resolving";
export const WORK_ORDER_TASKS_FROZEN_REFUSAL = "The checklist of a resolved or closed work order cannot be changed";

/** The most items one ticket's checklist may hold: the same bound as a template's list. */
export const WORK_ORDER_MAX_TASKS = 100;
export const WORK_ORDER_TASKS_FULL_REFUSAL = `A work order's checklist holds at most ${WORK_ORDER_MAX_TASKS} items`;

const refuse = (status: 400 | 409, message: string): TransitionRefusal => ({ status, message });

/**
 * Whether the checklist decides this move, so the caller reads it only then.
 *
 * Entering `resolved` is the ruled gate. `closed` reached straight from a live status is
 * gated too: until close is limited to a resolved ticket (decision 6.5, PR 5) that path
 * would step around the checklist. A ticket that is already `resolved` passed the gate
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
 * still `pending`, counted under the row lock; pass 0 when {@link needsChecklistGate}
 * is false.
 */
export function statusChangeRefusal(move: {
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;
  readonly pendingMandatory: number;
}): TransitionRefusal | null {
  if (move.from === "closed") {
    return refuse(400, WORK_ORDER_CLOSED_REFUSAL);
  }
  if (needsChecklistGate(move.from, move.to) && move.pendingMandatory > 0) {
    return refuse(409, WORK_ORDER_MANDATORY_PENDING_REFUSAL);
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
