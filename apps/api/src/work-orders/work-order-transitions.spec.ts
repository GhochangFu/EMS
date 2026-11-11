import { BadRequestException, ConflictException } from "@nestjs/common";
import { expect } from "vitest";

import type { WorkOrderStatus } from "@bms/shared";

import {
  needsChecklistGate,
  reorderMoveRefusal,
  statusChangeRefusal,
  taskAddRefusal,
  taskWriteRefusal,
  throwIfRefused,
  WORK_ORDER_CLOSED_REFUSAL,
  WORK_ORDER_CLOSE_BY_DRAG_REFUSAL,
  WORK_ORDER_MANDATORY_PENDING_REFUSAL,
  WORK_ORDER_MAX_TASKS,
  WORK_ORDER_REOPEN_REFUSAL,
  WORK_ORDER_RESOLVE_BY_DRAG_REFUSAL,
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
      expect(statusChangeRefusal({ from, to, pendingMandatory: 3 }), `${from} -> ${to}`).toBeNull();
    }
  }
}

/** D9 row 2: a mandatory item still pending blocks the move into `resolved` with 409. */
export function aPendingMandatoryItemBlocksResolve(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 1 }), `${from} -> resolved`).toEqual({
      status: 409,
      message: WORK_ORDER_MANDATORY_PENDING_REFUSAL,
    });
  }
}

/** D9 row 2, the other direction: with no mandatory item pending the move into `resolved` passes. */
export function resolvePassesWhenNoMandatoryItemIsPending(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "resolved", pendingMandatory: 0 }), `${from} -> resolved`).toBeNull();
  }
}

/** A write that leaves a `resolved` ticket `resolved` (a new assignee, a new position) is not a resolve. */
export function aTicketAlreadyResolvedIsNotGatedAgain(): void {
  expect(statusChangeRefusal({ from: "resolved", to: "resolved", pendingMandatory: 2 })).toBeNull();
  expect(needsChecklistGate("resolved", "resolved")).toBe(false);
}

/**
 * Until close is limited to a resolved ticket (PR 5), `closed` can be reached straight
 * from a live status. That path must not step around the checklist, so it is gated too;
 * closing a ticket that is already resolved is not.
 */
export function closingAnUnresolvedTicketIsGatedToo(): void {
  for (const from of LIVE) {
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 1 }), `${from} -> closed`).toEqual({
      status: 409,
      message: WORK_ORDER_MANDATORY_PENDING_REFUSAL,
    });
    expect(statusChangeRefusal({ from, to: "closed", pendingMandatory: 0 }), `${from} -> closed, clean`).toBeNull();
  }
  expect(statusChangeRefusal({ from: "resolved", to: "closed", pendingMandatory: 1 })).toBeNull();
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
    expect(statusChangeRefusal({ from: "closed", to, pendingMandatory: 0 }), `closed -> ${to}`).toEqual({
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

/** A reorder that leaves a resolved card in `resolved`, or takes it back to a live column, is allowed. */
export function aReorderWithinOrOutOfResolvedIsAllowed(): void {
  expect(reorderMoveRefusal({ from: "resolved", to: "resolved" })).toBeNull();
  for (const to of LIVE) {
    expect(reorderMoveRefusal({ from: "resolved", to }), `resolved -> ${to}`).toBeNull();
  }
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
