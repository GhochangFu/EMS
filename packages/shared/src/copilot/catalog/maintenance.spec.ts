import { expect } from "vitest";

import * as contracts from "../../contracts";
import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.281` (ADR 0099 Amendment 8, D2, D3, D6, Q15; owner rulings 2026-10-24
 * DC1, DC5) — the maintenance schedule entries. The rules every entry obeys
 * are `catalog.spec.ts`; this file holds what is particular to these three.
 * Vitest entry point: the sibling `.test.ts`.
 */

const ROW = "22222222-2222-4222-8222-222222222222";

const IDS = ["maintenanceSchedule.create", "maintenanceSchedule.activate", "maintenanceSchedule.deactivate"];

const CREATE = {
  assetId: ROW,
  title: "Quarterly filter check",
  category: "preventive",
  priority: "high",
  estimatedMinutes: 45,
  intervalDays: 90,
  firstDueAt: "2026-11-01T09:00:00.000Z",
};

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({ body: {}, params: { id: ROW }, targetName: "Chiller 2", organizationName: "Pune Works", ...input });
}

/** Q15: the configuration class admits every copilot role, so no entry narrows `offeredTo`. */
export function theEntriesAreOfferedToEveryCopilotRole(): void {
  for (const id of IDS) expect(entry(id).offeredTo, id).toBeUndefined();
}

/** D2: the create names the body's asset; the two directions name the schedule row. */
export function theTargetsMirrorTheRoutes(): void {
  expect(IDS.map((id) => entry(id).target)).toEqual([
    { kind: "maintenanceSchedule", field: "assetId" },
    { kind: "maintenanceSchedule", param: "id" },
    { kind: "maintenanceSchedule", param: "id" },
  ]);
}

/** D3: the deactivate is the red card; the activate is an edit. */
export function theDeactivateIsRedAndTheActivateIsAnEdit(): void {
  expect([entry("maintenanceSchedule.deactivate").risk, entry("maintenanceSchedule.activate").risk]).toEqual(["deactivate", "edit"]);
}

/** Owner ruling DC1: each direction proposes `active` fixed to its own value, with the optional reason. */
export function eachDirectionFixesActiveInItsModelBody(): void {
  const exports = contracts as unknown as Record<string, unknown>;
  const deactivate = entry("maintenanceSchedule.deactivate");
  const activate = entry("maintenanceSchedule.activate");
  expect(deactivate.modelBody).toBe(exports[deactivate.modelBodyName ?? ""]);
  expect(activate.modelBody).toBe(exports[activate.modelBodyName ?? ""]);
  expect(modelBodyOf(deactivate).safeParse({ active: true }).success).toBe(false);
  expect(modelBodyOf(activate).safeParse({ active: false }).success).toBe(false);
  expect(modelBodyOf(deactivate).safeParse({ active: false, reason: "Plant shut for the season" }).success).toBe(true);
}

/** Owner ruling DC1: neither direction is a `fixedBody`; each has a Reason step before Review. */
export function eachDirectionHasAReasonStep(): void {
  for (const id of ["maintenanceSchedule.activate", "maintenanceSchedule.deactivate"]) {
    expect(entry(id).fixedBody, id).toBeUndefined();
    expect(entry(id).steps.map((step) => step.id), id).toEqual(["reason"]);
  }
}

/** D6: no maintenance entry takes a precondition. */
export function noEntryTakesAPrecondition(): void {
  for (const id of IDS) expect(entry(id).precondition, id).toBeUndefined();
}

export function theCreateSummaryNamesTheSchedule(): void {
  const text = summary("maintenanceSchedule.create", { body: CREATE });
  for (const part of ['"Quarterly filter check"', "Chiller 2", "Pune Works", "every 90 days", "2026-11-01T09:00:00.000Z", "priority high", "45 min"]) {
    expect(text, part).toContain(part);
  }
}

export function theCreateSummaryNamesSafetyAndCompliance(): void {
  const text = summary("maintenanceSchedule.create", { body: { ...CREATE, safetyCritical: true, complianceRef: "IS 2026" } });
  expect(text).toContain("safety-critical");
  expect(text).toContain('compliance ref "IS 2026"');
}

/** The adjacent negative: neither phrase without the fields. */
export function theCreateSummaryOmitsSafetyAndComplianceWhenAbsent(): void {
  const text = summary("maintenanceSchedule.create", { body: CREATE });
  expect(text).not.toContain("safety-critical");
  expect(text).not.toContain("compliance ref");
}

/** Owner ruling DC5: the card says what a deactivate does to the list and to work orders. */
export function theDirectionSummariesNameTheEffect(): void {
  expect(summary("maintenanceSchedule.deactivate")).toBe(
    'Deactivate the maintenance schedule "Chiller 2": it leaves the default Schedule Centre list and no work order is generated from it until it is activated again.',
  );
  expect(summary("maintenanceSchedule.activate")).toBe(
    'Activate the maintenance schedule "Chiller 2": it returns to the default Schedule Centre list and work orders can be generated from it again.',
  );
}

/** A reason the user gave is on the card, so the person confirming reads what the audit row records. */
export function aDirectionSummaryQuotesItsReason(): void {
  expect(summary("maintenanceSchedule.deactivate", { body: { active: false, reason: "Plant shut" } })).toContain('Reason: "Plant shut".');
}

/** Amendment 8 "Not in this amendment": the convert creates a work order and is excluded. */
export function theConvertIsExcluded(): void {
  const maintenance = EXCLUDED_ROUTES.filter((route) => route.path.startsWith("/maintenance/"));
  expect(maintenance).toEqual([
    { method: "POST", path: "/maintenance/schedules/:id/convert", reason: "creates a work order; ADR 0099 decision 1" },
  ]);
}
