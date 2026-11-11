import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import type { WorkOrderStatus } from "@bms/shared";

import {
  approvalRefusal,
  cancelRefusal,
  isSelfApproval,
  isTerminalWorkOrderStatus,
  rejectRefusal,
  needsChecklistGate,
  clearsResolveStamps,
  reorderMoveRefusal,
  rootCauseMissing,
  rootCauseWriteRefusal,
  statusChangeRefusal,
  taskAddRefusal,
  taskWriteRefusal,
  throwIfRefused,
  WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL,
  WORK_ORDER_CANCEL_BY_STATUS_REFUSAL,
  WORK_ORDER_CANCELLED_REFUSAL,
  WORK_ORDER_CLOSED_REFUSAL,
  WORK_ORDER_CLOSE_BY_DRAG_REFUSAL,
  WORK_ORDER_CLOSE_BY_STATUS_REFUSAL,
  WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL,
  WORK_ORDER_FINDINGS_FROZEN_REFUSAL,
  WORK_ORDER_FINDINGS_KEPT_REFUSAL,
  WORK_ORDER_LEAVE_RESOLVED_REFUSAL,
  WORK_ORDER_MANDATORY_PENDING_REFUSAL,
  WORK_ORDER_MAX_TASKS,
  WORK_ORDER_REOPEN_REFUSAL,
  WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL,
  WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL,
  WORK_ORDER_TASKS_FROZEN_REFUSAL,
  WORK_ORDER_TASKS_FULL_REFUSAL,
} from "./work-order-transitions";

/**
 * `E3.1` (ADR 0122, plan D9, T3.2 and T5.2) — the whole transition table.
 * Pure: no database. Assertions live here; `work-order-transitions.test.ts` runs them
 * (ADR 0014). The integration suite proves the service asks these functions under the
 * row lock.
 */

const LIVE: readonly WorkOrderStatus[] = ["open", "assigned", "in_progress"];
const ALL: readonly WorkOrderStatus[] = ["open", "assigned", "in_progress", "resolved", "closed", "cancelled"];
const TERMINAL: readonly WorkOrderStatus[] = ["closed", "cancelled"];
const TERMINAL_SENTENCE = { closed: WORK_ORDER_CLOSED_REFUSAL, cancelled: WORK_ORDER_CANCELLED_REFUSAL } as const;

/** D9 row 1: the three live statuses move freely among themselves, whatever the checklist says. */
export function liveStatusesMoveFreely(): void {
  for (const from of LIVE) {
    for (const to of LIVE) {
      expect(statusChangeRefusal({ from, to, pendingMandatory: 3, rootCauseMissing: true }), `${from} -> ${to}`).toBeNull();
    }
  }
}

/** D9 row 2: a mandatory item still pending blocks the move into `resolved` with 409. */
export function aPendingMandatoryItemBlocksResolve(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 1, rootCauseMissing: false }), `${from} -> resolved`).toEqual({
      status: 409,
      message: WORK_ORDER_MANDATORY_PENDING_REFUSAL,
    });
  }
}

/** D9 row 2, the other direction: with no mandatory item pending the move into `resolved` passes. */
export function resolvePassesWhenNoMandatoryItemIsPending(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 0, rootCauseMissing: false }), `${from} -> resolved`).toBeNull();
  }
}

/** A write that leaves a `resolved` ticket `resolved` (a new assignee, a new position) is not a resolve. */
export function aTicketAlreadyResolvedIsNotGatedAgain(): void {
  expect(statusChangeRefusal({ from: "resolved", to: "resolved", pendingMandatory: 2, rootCauseMissing: true })).toBeNull();
  expect(needsChecklistGate("resolved", "resolved")).toBe(false);
}

/**
 * D9 row 4 (decision 6.5): the status route never closes and never cancels. Whatever the
 * ticket's status, `closed` and `cancelled` as a target answer 400 with their own
 * sentence — a resolved ticket included, which only the approval may close.
 */
export function theStatusRouteNeverClosesOrCancels(): void {
  for (const from of [...LIVE, "resolved"] as const) {
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 0, rootCauseMissing: false }), `${from} -> closed`).toEqual({
      status: 400,
      message: WORK_ORDER_CLOSE_BY_STATUS_REFUSAL,
    });
    expect(statusChangeRefusal({ from, to: "cancelled", pendingMandatory: 0, rootCauseMissing: false }), `${from} -> cancelled`).toEqual({
      status: 400,
      message: WORK_ORDER_CANCEL_BY_STATUS_REFUSAL,
    });
  }
}

/** The gate reads the checklist exactly when it must: entering `resolved` from a live status. */
export function theChecklistIsReadOnlyWhenItDecides(): void {
  const gated = ALL.flatMap((from) => ALL.filter((to) => needsChecklistGate(from, to)).map((to) => `${from}>${to}`));
  expect(gated).toEqual(["open>resolved", "assigned>resolved", "in_progress>resolved"]);
}

/** D9 row 5: any status write on a `closed` or `cancelled` ticket is refused with 400, before anything else is considered. */
export function aTerminalTicketRefusesEveryStatusWrite(): void {
  for (const from of ["closed", "cancelled"] as const) {
    for (const to of ALL) {
      expect(statusChangeRefusal({ from, to, pendingMandatory: 3, rootCauseMissing: true }), `${from} -> ${to}`).toEqual({
        status: 400,
        message: TERMINAL_SENTENCE[from],
      });
    }
  }
  expect(ALL.filter((status) => isTerminalWorkOrderStatus(status))).toEqual(TERMINAL);
}

/** D9 row 6 (decision 6.5, ruling P2): the approval takes a `resolved` ticket only — 409 from a live status, 400 from a terminal one. */
export function onlyAResolvedTicketIsApproved(): void {
  expect(approvalRefusal("resolved")).toBeNull();
  for (const from of LIVE) {
    expect(approvalRefusal(from), from).toEqual({ status: 409, message: WORK_ORDER_APPROVE_NOT_RESOLVED_REFUSAL });
  }
  for (const from of ["closed", "cancelled"] as const) {
    expect(approvalRefusal(from), from).toEqual({ status: 400, message: TERMINAL_SENTENCE[from] });
  }
}

/** D9 row 7 (decision 6.4): a reject takes a `resolved` ticket only — 409 from a live status, 400 from a terminal one. */
export function onlyAResolvedTicketIsRejected(): void {
  expect(rejectRefusal("resolved")).toBeNull();
  for (const from of LIVE) {
    expect(rejectRefusal(from), from).toEqual({ status: 409, message: WORK_ORDER_REJECT_NOT_RESOLVED_REFUSAL });
  }
  for (const from of ["closed", "cancelled"] as const) {
    expect(rejectRefusal(from), from).toEqual({ status: 400, message: TERMINAL_SENTENCE[from] });
  }
}

/** D9 row 8 (decision 6.8): a cancel takes any live or resolved ticket; a terminal one answers 400. */
export function aCancelTakesAnyLiveOrResolvedTicket(): void {
  for (const from of [...LIVE, "resolved"] as const) {
    expect(cancelRefusal(from), from).toBeNull();
  }
  for (const from of ["closed", "cancelled"] as const) {
    expect(cancelRefusal(from), from).toEqual({ status: 400, message: TERMINAL_SENTENCE[from] });
  }
}

/** Ruling Q11: self-approval is the approver being the resolver; a ticket with no recorded resolver is never marked. */
export function selfApprovalIsTheApproverBeingTheResolver(): void {
  expect(isSelfApproval("user-a", "user-a")).toBe(true);
  expect(isSelfApproval("user-a", "user-b")).toBe(false);
  expect(isSelfApproval(null, "user-a"), "resolved before resolved_by existed").toBe(false);
}

/** D9 row 9 (ruling P1): a reorder may not move a card into `resolved`; it answers 400. */
export function aReorderIntoResolvedIsRefused(): void {
  for (const from of LIVE) {
    expect(reorderMoveRefusal({ from, to: "resolved" }), `${from} -> resolved`).toEqual({
      status: 400,
      message: WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL,
    });
  }
}

/** A reorder may leave a resolved card in `resolved` or take it back to In progress; live columns move freely. */
export function aReorderWithinOrOutOfResolvedIsAllowed(): void {
  expect(reorderMoveRefusal({ from: "resolved", to: "resolved" })).toBeNull();
  expect(reorderMoveRefusal({ from: "resolved", to: "in_progress" })).toBeNull();
  for (const from of LIVE) {
    for (const to of LIVE) {
      expect(reorderMoveRefusal({ from, to }), `${from} -> ${to}`).toBeNull();
    }
  }
}

/** The two older reorder rules are unchanged: no drag into Done, no drag out of it. */
export function aReorderStillRefusesDone(): void {
  expect(reorderMoveRefusal({ from: "in_progress", to: "closed" })).toEqual({ status: 400, message: WORK_ORDER_CLOSE_BY_DRAG_REFUSAL });
  expect(reorderMoveRefusal({ from: "resolved", to: "closed" })).toEqual({ status: 400, message: WORK_ORDER_CLOSE_BY_DRAG_REFUSAL });
  expect(reorderMoveRefusal({ from: "closed", to: "open" })).toEqual({ status: 400, message: WORK_ORDER_REOPEN_REFUSAL });
  expect(reorderMoveRefusal({ from: "closed", to: "closed" })).toBeNull();
}

/** Decision 6.8: a cancelled ticket is on no column — a reorder neither moves it nor moves a card into it (400). */
export function aReorderNeverTouchesACancelledTicket(): void {
  const refused = { status: 400, message: WORK_ORDER_CANCELLED_REFUSAL };
  for (const other of ALL) {
    expect(reorderMoveRefusal({ from: "cancelled", to: other }), `cancelled -> ${other}`).toEqual(refused);
    expect(reorderMoveRefusal({ from: other, to: "cancelled" }), `${other} -> cancelled`).toEqual(refused);
  }
}

/** A checklist write is refused with 409 once the ticket is `resolved`, `closed` or `cancelled`. */
export function aResolvedOrClosedTicketFreezesItsChecklist(): void {
  for (const status of LIVE) {
    expect(taskWriteRefusal(status), status).toBeNull();
  }
  for (const status of ["resolved", "closed", "cancelled"] as const) {
    expect(taskWriteRefusal(status), status).toEqual({ status: 409, message: WORK_ORDER_TASKS_FROZEN_REFUSAL });
  }
}

/** A refusal becomes the HTTP error of its status; no refusal throws nothing. */
export function aRefusalThrowsTheErrorOfItsStatus(): void {
  expect(() => throwIfRefused(null)).not.toThrow();
  expect(() => throwIfRefused({ status: 400, message: "x" })).toThrow(BadRequestException);
  expect(() => throwIfRefused({ status: 409, message: "y" })).toThrow(ConflictException);
  expect(() => throwIfRefused({ status: 409, message: "the sentence" })).toThrow("the sentence");
}

/** A checklist holds at most 100 items: the hundredth may be added, the next is refused with 409. */
export function aFullChecklistRefusesOneMore(): void {
  expect(WORK_ORDER_MAX_TASKS).toBe(100);
  expect(taskAddRefusal(0)).toBeNull();
  expect(taskAddRefusal(99), "the hundredth item").toBeNull();
  expect(taskAddRefusal(100), "the hundred and first").toEqual({ status: 409, message: WORK_ORDER_TASKS_FULL_REFUSAL });
}

const FULL = { rootCause: "Bearing worn out", correctiveAction: "Bearing replaced", causeCode: "wear_and_tear" };

/** Decision 5.2: the three findings are owed only by a ticket raised from an alarm, and each one counts. */
export function onlyAnAlarmTicketOwesARootCause(): void {
  expect(rootCauseMissing({ hasAlarm: true, ...FULL })).toBe(false);
  for (const key of ["rootCause", "correctiveAction", "causeCode"] as const) {
    expect(rootCauseMissing({ hasAlarm: true, ...FULL, [key]: null }), `${key} null`).toBe(true);
    expect(rootCauseMissing({ hasAlarm: true, ...FULL, [key]: "   " }), `${key} blank`).toBe(true);
  }
  expect(rootCauseMissing({ hasAlarm: false, rootCause: null, correctiveAction: null, causeCode: null })).toBe(false);
}

/** D9 row 2: an alarm ticket with a finding missing is refused `resolved` with 409; with them it passes. */
export function aMissingRootCauseBlocksResolve(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 0, rootCauseMissing: true }), `${from} -> resolved`).toEqual({
      status: 409,
      message: WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL,
    });
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 0, rootCauseMissing: false })).toBeNull();
  }
  expect(statusChangeRefusal({ from: "open", to: "in_progress", pendingMandatory: 0, rootCauseMissing: true }), "a live move owes nothing").toBeNull();
  expect(statusChangeRefusal({ from: "resolved", to: "resolved", pendingMandatory: 0, rootCauseMissing: true }), "already resolved").toBeNull();
}

/** With both gates failing, the checklist's sentence is the one the caller reads first. */
export function theChecklistIsNamedBeforeTheRootCause(): void {
  expect(statusChangeRefusal({ from: "in_progress", to: "resolved", pendingMandatory: 1, rootCauseMissing: true })?.message).toBe(
    WORK_ORDER_MANDATORY_PENDING_REFUSAL,
  );
}

/** D9 row 3 (ruling P3): a resolved ticket goes back to `in_progress` only; `open` and `assigned` answer 409. */
export function aResolvedTicketGoesBackToInProgressOnly(): void {
  expect(statusChangeRefusal({ from: "resolved", to: "in_progress", pendingMandatory: 0, rootCauseMissing: false })).toBeNull();
  for (const to of ["open", "assigned"] as const) {
    const refused = { status: 409, message: WORK_ORDER_LEAVE_RESOLVED_REFUSAL };
    expect(statusChangeRefusal({ from: "resolved", to, pendingMandatory: 0, rootCauseMissing: false }), `status -> ${to}`).toEqual(refused);
    expect(reorderMoveRefusal({ from: "resolved", to }), `reorder -> ${to}`).toEqual(refused);
  }
}

/** The resolve stamps are cleared exactly when a resolved ticket goes back to work. */
export function theResolveStampsClearOnTheWayBack(): void {
  const cleared = ALL.flatMap((from) => ALL.filter((to) => clearsResolveStamps(from, to)).map((to) => `${from}>${to}`));
  expect(cleared).toEqual(["resolved>in_progress"]);
}

/** Decision 5.3: findings are editable up to `resolved` and frozen at `closed` and `cancelled` (409). */
export function findingsAreFrozenAtClosed(): void {
  const none = { hasAlarm: true, missingAfter: false };
  for (const status of ["open", "assigned", "in_progress", "resolved"] as const) {
    expect(rootCauseWriteRefusal({ status, ...none }), status).toBeNull();
  }
  for (const status of ["closed", "cancelled"] as const) {
    expect(rootCauseWriteRefusal({ status, ...none }), status).toEqual({ status: 409, message: WORK_ORDER_FINDINGS_FROZEN_REFUSAL });
  }
}

/** A resolved alarm ticket must keep the findings it resolved with; before `resolved` they may be cleared. */
export function aResolvedAlarmTicketKeepsItsFindings(): void {
  expect(rootCauseWriteRefusal({ status: "resolved", hasAlarm: true, missingAfter: true })).toEqual({
    status: 409,
    message: WORK_ORDER_FINDINGS_KEPT_REFUSAL,
  });
  expect(rootCauseWriteRefusal({ status: "in_progress", hasAlarm: true, missingAfter: true })).toBeNull();
  expect(rootCauseWriteRefusal({ status: "resolved", hasAlarm: false, missingAfter: true }), "a planned ticket owes none").toBeNull();
}
