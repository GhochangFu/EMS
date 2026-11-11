import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import type { WorkOrderStatus } from "@bms/shared";

import {
  needsChecklistGate,
  clearsResolveStamps,
  reorderMoveRefusal,
  rootCauseMissing,
  rootCauseWriteRefusal,
  statusChangeRefusal,
  taskAddRefusal,
  taskWriteRefusal,
  throwIfRefused,
  WORK_ORDER_CLOSED_REFUSAL,
  WORK_ORDER_CLOSE_BY_DRAG_REFUSAL,
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
 * `E3.1` (ADR 0122, plan D9 and T3.2) — the transition table, as far as PR 3 builds it.
 * Pure: no database. Assertions live here; `work-order-transitions.test.ts` runs them
 * (ADR 0014). The integration suite proves the service asks these functions under the
 * row lock.
 */

const LIVE: readonly WorkOrderStatus[] = ["open", "assigned", "in_progress"];
const ALL: readonly WorkOrderStatus[] = ["open", "assigned", "in_progress", "resolved", "closed"];

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
 * Until close is limited to a resolved ticket (PR 5), `closed` can be reached straight
 * from a live status. That path must not step around the checklist, so it is gated too;
 * closing a ticket that is already resolved is not.
 */
export function closingAnUnresolvedTicketIsGatedToo(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 1, rootCauseMissing: false }), `${from} -> closed`).toEqual({
      status: 409,
      message: WORK_ORDER_MANDATORY_PENDING_REFUSAL,
    });
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 0, rootCauseMissing: false }), `${from} -> closed, clean`).toBeNull();
  }
  expect(statusChangeRefusal({ from: "resolved", to: "closed", pendingMandatory: 1, rootCauseMissing: false })).toBeNull();
}

/** The gate reads the checklist exactly when it must: entering `resolved`, or `closed` from a live status. */
export function theChecklistIsReadOnlyWhenItDecides(): void {
  const gated = ALL.flatMap((from) => ALL.filter((to) => needsChecklistGate(from, to)).map((to) => `${from}>${to}`));
  expect(gated).toEqual([
    "open>resolved",
    "open>closed",
    "assigned>resolved",
    "assigned>closed",
    "in_progress>resolved",
    "in_progress>closed",
  ]);
}

/** D9 row 5: any status write on a `closed` ticket is refused with 400, before the checklist is considered. */
export function aClosedTicketRefusesEveryStatusWrite(): void {
  for (const to of ALL) {
    expect(statusChangeRefusal({ from: "closed", to, pendingMandatory: 0, rootCauseMissing: false }), `closed -> ${to}`).toEqual({
      status: 400,
      message: WORK_ORDER_CLOSED_REFUSAL,
    });
  }
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

/** A checklist write is refused with 409 once the ticket is `resolved` or `closed`. */
export function aResolvedOrClosedTicketFreezesItsChecklist(): void {
  for (const status of LIVE) {
    expect(taskWriteRefusal(status), status).toBeNull();
  }
  for (const status of ["resolved", "closed"] as const) {
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
    // A close that skips resolved is gated the same way, until close is limited to a resolved ticket.
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 0, rootCauseMissing: true })?.message).toBe(
      WORK_ORDER_ROOT_CAUSE_REQUIRED_REFUSAL,
    );
  }
  expect(statusChangeRefusal({ from: "open", to: "in_progress", pendingMandatory: 0, rootCauseMissing: true }), "a live move owes nothing").toBeNull();
  expect(statusChangeRefusal({ from: "resolved", to: "closed", pendingMandatory: 0, rootCauseMissing: true }), "already resolved").toBeNull();
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

/** Decision 5.3: findings are editable up to `resolved` and frozen at `closed` (409). */
export function findingsAreFrozenAtClosed(): void {
  const none = { hasAlarm: true, missingAfter: false };
  for (const status of ["open", "assigned", "in_progress", "resolved"] as const) {
    expect(rootCauseWriteRefusal({ status, ...none }), status).toBeNull();
  }
  expect(rootCauseWriteRefusal({ status: "closed", ...none })).toEqual({ status: 409, message: WORK_ORDER_FINDINGS_FROZEN_REFUSAL });
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
