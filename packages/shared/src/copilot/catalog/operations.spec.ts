import { expect } from "vitest";

import * as contracts from "../../contracts";
import { CANVAS_ENTRY_IDS, catalogEntry, COPILOT_CATALOG, EXCLUDED_ROUTES, hashExcludedKeysOf } from "./index";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.284` (ADR 0106; owner rulings 2026-10-24 DC2, DC4, DC5) — the alarm and
 * work-order entries. The rules every entry obeys are `catalog.spec.ts`; this
 * file holds what is particular to these six. Vitest entry point: the sibling
 * `.test.ts`.
 */

const ROW = "22222222-2222-4222-8222-222222222222";

const IDS = [
  "alarm.acknowledge",
  "alarm.enrichment.set",
  "workOrder.create",
  "workOrder.setStatus",
  "workOrder.close",
  "workOrder.reorder",
] as const;

const ALARM = { message: "Main breaker tripped", severity: "critical", assetName: "MCC-1", raisedAt: "2026-10-24T08:15:00.000Z" };

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({ body: {}, params: { id: ROW }, targetName: "Target 7", organizationName: "Pune Works", ...input });
}

/** Decision 2: the six routes, method and path, each a catalog entry and none excluded. */
export function theSixRoutesAreEntries(): void {
  expect(IDS.map((id) => `${entry(id).method} ${entry(id).path}`)).toEqual([
    "POST /alarms/:id/ack",
    "PUT /alarms/:id/enrichment",
    "POST /work-orders",
    "PATCH /work-orders/:id/status",
    "POST /work-orders/:id/close",
    "PATCH /work-orders/reorder",
  ]);
}

export function noOperationsRouteIsExcluded(): void {
  expect(EXCLUDED_ROUTES.filter((route) => route.path.startsWith("/alarms") || route.path.startsWith("/work-orders"))).toEqual([]);
}

/** Each body is the route's own export by name. */
export function theBodyNamesAreTheRoutesExports(): void {
  expect(IDS.map((id) => entry(id).bodyName)).toEqual([
    "alarmAckBodySchema",
    "alarmEnrichmentUpsertBodySchema",
    "createWorkOrderBodySchema",
    "updateWorkOrderStatusBodySchema",
    "closeWorkOrderBodySchema",
    "reorderWorkOrdersBodySchema",
  ]);
}

/** Decision 4: the acknowledge and the close are `operational`; the rest keep create and edit. */
export function theRisksAreAsRuled(): void {
  expect(IDS.map((id) => entry(id).risk)).toEqual(["operational", "edit", "create", "edit", "operational", "edit"]);
}

/** Exactly two entries in the whole catalog are `operational`. */
export function onlyTheAckAndTheCloseAreOperational(): void {
  expect(COPILOT_CATALOG.filter((candidate) => candidate.risk === "operational").map((candidate) => candidate.id)).toEqual([
    "alarm.acknowledge",
    "workOrder.close",
  ]);
}

/** Decision 6 and DC5: the targets mirror the routes. */
export function theTargetsMirrorTheRoutes(): void {
  expect(IDS.map((id) => entry(id).target)).toEqual([
    { kind: "alarm", param: "id" },
    { kind: "alarm", param: "id" },
    { kind: "workOrder", field: "assetId" },
    { kind: "workOrder", param: "id" },
    { kind: "workOrder", param: "id" },
    { kind: "workOrderBatch", field: "items" },
  ]);
}

/** Decision 6: the create's assignee and alarm, and the status change's assignee, are refs of the change's organization. */
export function theRefsNameTheAssigneeAndTheAlarm(): void {
  expect(entry("workOrder.create").refs).toEqual([
    { field: "alarmId", kind: "alarm" },
    { field: "assignedTo", kind: "user" },
  ]);
  expect(entry("workOrder.setStatus").refs).toEqual([{ field: "assignedTo", kind: "user" }]);
}

/** Q1: every copilot role may propose them; no entry narrows `offeredTo`. */
export function theEntriesAreOfferedToEveryCopilotRole(): void {
  for (const id of IDS) expect(entry(id).offeredTo, id).toBeUndefined();
}

/** No entry takes a precondition. */
export function noEntryTakesAPrecondition(): void {
  for (const id of IDS) expect(entry(id).precondition, id).toBeUndefined();
}

/** Decision 3: the ack's only step is its reason, which is a body field (so the hash binds it). */
export function theAckHasAReasonStep(): void {
  expect(entry("alarm.acknowledge").steps).toEqual([{ id: "reason", title: "Reason", fields: ["reason"] }]);
  expect(hashExcludedKeysOf(entry("alarm.acknowledge"))).toEqual([]);
}

/** Decision 2: the status model body is the shared export that leaves out `closed`. */
export function theStatusModelBodyLeavesOutClosed(): void {
  const status = entry("workOrder.setStatus");
  expect(status.modelBodyName).toBe("copilotWorkOrderSetStatusModelBodySchema");
  expect(status.modelBody).toBe((contracts as unknown as Record<string, unknown>)[status.modelBodyName ?? ""]);
  expect(modelBodyOf(status).safeParse({ status: "closed" }).success).toBe(false);
}

/** Owner ruling 2026-10-25 (Q4), replacing DC4: the enrichment model body carries `skillCode`, as the route body does. */
export function theEnrichmentModelBodyCarriesSkillCode(): void {
  expect(modelBodyOf(entry("alarm.enrichment.set")).safeParse({ skillCode: "electrical" }).success).toBe(true);
}

/** The resolver reads `skillCode` as an `alarmSkill` ref, so an unknown code is refused before the card. */
export function theEnrichmentChecksItsSkillCodeAsARef(): void {
  expect(entry("alarm.enrichment.set").refs).toEqual([{ field: "skillCode", kind: "alarmSkill" }]);
}

/** DC2: the reorder is a canvas entry with no steps, and its card-only `moves` is left out of the hash. */
export function theReorderIsACanvasEntryWithCardOnlyMoves(): void {
  const reorder = entry("workOrder.reorder");
  expect((CANVAS_ENTRY_IDS as readonly string[]).includes(reorder.id)).toBe(true);
  expect(reorder.steps).toEqual([]);
  expect(reorder.cardOnly).toEqual(["moves"]);
  expect(hashExcludedKeysOf(reorder)).toContain("moves");
}

/** Decision 3: the ack card names the alarm text, severity, asset and raised time, and the reason in full. */
export function theAckSummaryNamesTheAlarm(): void {
  const text = summary("alarm.acknowledge", { body: { reason: "Panel checked on site" }, alarm: ALARM });
  for (const part of ['"Main breaker tripped"', "critical", "MCC-1", "2026-10-24T08:15:00.000Z", 'Reason: "Panel checked on site".']) {
    expect(text, part).toContain(part);
  }
}

/** The status card says where the work order moves from and to. */
export function theStatusSummaryNamesFromAndTo(): void {
  const text = summary("workOrder.setStatus", {
    body: { status: "in_progress" },
    targetName: "Check the breaker",
    workOrder: { title: "Check the breaker", status: "open", assetName: "MCC-1" },
  });
  expect(text).toContain('Move the work order "Check the breaker" from open to in progress');
}

/** The reorder card counts the work orders and names the organization. */
export function theReorderSummaryCountsTheWorkOrders(): void {
  const items = [
    { id: ROW, status: "open", sortOrder: 0 },
    { id: ROW, status: "assigned", sortOrder: 1 },
  ];
  expect(summary("workOrder.reorder", { body: { items } })).toContain("Reorder 2 work orders in Pune Works");
}

/** The close card quotes its reason. */
export function theCloseSummaryQuotesItsReason(): void {
  expect(summary("workOrder.close", { body: { reason: "Repaired and tested" } })).toContain('Reason: "Repaired and tested".');
}
