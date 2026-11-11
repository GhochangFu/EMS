import { expect } from "vitest";

import {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  cancelWorkOrderBodySchema,
  closeWorkOrderBodySchema,
  copilotAlarmEnrichmentModelBodySchema,
  copilotWorkOrderSetStatusModelBodySchema,
  createWorkOrderBodySchema,
  rejectWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "./operations-writes";
import { boardWorkOrderStatusSchema, settableWorkOrderStatusSchema, TERMINAL_WORK_ORDER_STATUSES, workOrderStatusSchema } from "./operations";

/**
 * `F4.284` (ADR 0106 decision 7, ADR 0030) — the alarm and work-order write
 * bodies, moved from `apps/api/src/alarms/` and `apps/api/src/work-orders/`.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ID = "22222222-2222-4222-8222-222222222222";

export function theAckBodyIsStrict(): void {
  expect(alarmAckBodySchema.safeParse({ reason: "Panel checked", extra: 1 }).success).toBe(false);
}

export function theAckBodyRefusesAShortReason(): void {
  expect(alarmAckBodySchema.safeParse({ reason: "ok" }).success).toBe(false);
}

export function theEnrichmentBodyIsStrict(): void {
  expect(alarmEnrichmentUpsertBodySchema.safeParse({ rootCause: "Loose lug", extra: 1 }).success).toBe(false);
}

/** Owner ruling 2026-10-25 (Q4): the copilot's enrichment body carries `skillCode` again (`list_alarm_skills` lists the codes). */
export function theEnrichmentModelBodyAcceptsASkillCode(): void {
  expect(copilotAlarmEnrichmentModelBodySchema.safeParse({ rootCause: "Loose lug", skillCode: "electrical" }).success).toBe(true);
}

export function theEnrichmentModelBodyAcceptsTheAnalysis(): void {
  expect(copilotAlarmEnrichmentModelBodySchema.safeParse({ rootCause: "Loose lug", affectedAssetIds: [ID] }).success).toBe(true);
}

export function theCreateBodyIsStrict(): void {
  expect(createWorkOrderBodySchema.safeParse({ assetId: ID, title: "Check the breaker", extra: 1 }).success).toBe(false);
}

export function theStatusBodyIsStrict(): void {
  expect(updateWorkOrderStatusBodySchema.safeParse({ status: "open", extra: 1 }).success).toBe(false);
}

export function theStatusModelBodyRefusesClosed(): void {
  expect(copilotWorkOrderSetStatusModelBodySchema.safeParse({ status: "closed" }).success).toBe(false);
}

export function theStatusModelBodyAcceptsTheOtherFour(): void {
  const accepted = ["open", "assigned", "in_progress", "resolved"].filter(
    (status) => copilotWorkOrderSetStatusModelBodySchema.safeParse({ status }).success,
  );
  expect(accepted).toEqual(["open", "assigned", "in_progress", "resolved"]);
}

export function theStatusModelBodyIsStrict(): void {
  expect(copilotWorkOrderSetStatusModelBodySchema.safeParse({ status: "open", extra: 1 }).success).toBe(false);
}

export function theCloseBodyIsStrict(): void {
  expect(closeWorkOrderBodySchema.safeParse({ reason: "Done and tested", extra: 1 }).success).toBe(false);
}

export function theReorderBodyIsStrict(): void {
  expect(reorderWorkOrdersBodySchema.safeParse({ items: [{ id: ID, status: "open", sortOrder: 0 }], extra: 1 }).success).toBe(false);
}

export function theReorderBodyRefuses101Items(): void {
  const items = Array.from({ length: 101 }, (_, i) => ({ id: ID, status: "open", sortOrder: i }));
  expect(reorderWorkOrdersBodySchema.safeParse({ items }).success).toBe(false);
}

/** `E3.1` (ADR 0122 decision 6.5, plan D19): the status body takes the four settable statuses; `closed` and `cancelled` are refused. */
export function theStatusBodyTakesTheFourSettableStatuses(): void {
  const all = workOrderStatusSchema.options;
  expect(all).toEqual(["open", "assigned", "in_progress", "resolved", "closed", "cancelled"]);
  expect(all.filter((status) => updateWorkOrderStatusBodySchema.safeParse({ status }).success)).toEqual(settableWorkOrderStatusSchema.options);
  expect(settableWorkOrderStatusSchema.options).toEqual(["open", "assigned", "in_progress", "resolved"]);
  // The copilot's model body and the route's body now take the same four.
  expect(all.filter((status) => copilotWorkOrderSetStatusModelBodySchema.safeParse({ status }).success)).toEqual(
    settableWorkOrderStatusSchema.options,
  );
}

/** Decision 6.8, plan D19: a reorder item takes the five columns; `cancelled` is refused. */
export function aReorderItemTakesTheFiveColumns(): void {
  const item = (status: string) => reorderWorkOrdersBodySchema.safeParse({ items: [{ id: ID, status, sortOrder: 0 }] }).success;
  expect(workOrderStatusSchema.options.filter(item)).toEqual(boardWorkOrderStatusSchema.options);
  expect(boardWorkOrderStatusSchema.options).toEqual(["open", "assigned", "in_progress", "resolved", "closed"]);
}

/** Decisions 6.4 and 6.8: reject and cancel each take a reason of 3 to 2000 characters, and nothing else. */
export function rejectAndCancelTakeAReasonOnly(): void {
  for (const [name, schema] of [
    ["reject", rejectWorkOrderBodySchema],
    ["cancel", cancelWorkOrderBodySchema],
  ] as const) {
    expect(schema.safeParse({ reason: "Raised by mistake" }).success, name).toBe(true);
    expect(schema.safeParse({}).success, `${name}: the reason is required`).toBe(false);
    expect(schema.safeParse({ reason: "no" }).success, `${name}: too short`).toBe(false);
    // Trimmed before it is measured: blanks are not a reason, and the stored reason carries no padding.
    expect(schema.safeParse({ reason: "      " }).success, `${name}: blanks`).toBe(false);
    expect(schema.safeParse({ reason: "  ok  " }).success, `${name}: two letters and padding`).toBe(false);
    expect(schema.parse({ reason: "  Raised by mistake  " }).reason, `${name}: trimmed`).toBe("Raised by mistake");
    expect(schema.safeParse({ reason: "x".repeat(2001) }).success, `${name}: too long`).toBe(false);
    expect(schema.safeParse({ reason: "Raised by mistake", status: "open" }).success, `${name}: strict`).toBe(false);
    expect(schema.safeParse({ reason: "Raised by mistake", sortOrder: 0 }).success, `${name}: no sortOrder`).toBe(false);
  }
}

/** Plan D20: the terminal statuses are exactly `closed` and `cancelled`. */
export function theTerminalStatusesAreClosedAndCancelled(): void {
  expect([...TERMINAL_WORK_ORDER_STATUSES]).toEqual(["closed", "cancelled"]);
}
