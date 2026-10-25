import { expect } from "vitest";

import {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  closeWorkOrderBodySchema,
  copilotAlarmEnrichmentModelBodySchema,
  copilotWorkOrderSetStatusModelBodySchema,
  createWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "./operations-writes";

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
