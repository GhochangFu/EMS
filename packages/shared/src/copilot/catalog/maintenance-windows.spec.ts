import { expect } from "vitest";

import * as contracts from "../../contracts";
import { catalogEntry, EXCLUDED_ROUTES } from "./index";
import { MAINTENANCE_WINDOW_PENDING } from "./maintenance-windows";
import { modelBodyOf } from "./model-body";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19 decisions 1, 2, 5; rulings Q1, Q4, Q5,
 * Q6, Q7) — the four maintenance-window entries. The rules every entry obeys
 * are `catalog.spec.ts`'s (a fixture per entry, the body by identity, every
 * field in one step, strict); this file holds what is particular to these
 * four. Vitest entry point: the sibling `.test.ts`.
 */

const ROW = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

export const MAINTENANCE_WINDOW_IDS = [
  "maintenanceWindow.create",
  "maintenanceWindow.extend",
  "maintenanceWindow.end",
  "maintenanceWindow.cancel",
];

function entry(id: string): CatalogEntry {
  const found = catalogEntry(id);
  if (!found) throw new Error(`no catalog entry ${id}`);
  return found;
}

const WINDOW: NonNullable<CatalogSummaryInput["maintenanceWindow"]> = {
  reason: "Chiller 2 compressor overhaul",
  startsAt: "2026-11-13T08:00:00.000Z",
  endsAt: "2026-11-13T18:00:00.000Z",
  targetLabels: ["Chiller 2", "Plant B"],
  locationLabels: ["Plant B"],
  coveredAssetCount: 12,
};

function summary(id: string, input: Partial<CatalogSummaryInput> = {}): string {
  return entry(id).summary({
    body: {},
    params: { id: ROW },
    targetName: "Chiller 2 compressor overhaul",
    organizationName: "Pune Works",
    maintenanceWindow: WINDOW,
    ...input,
  });
}

/** `count` distinct asset targets, the first `ASSET` (the model body refuses a target named twice). */
const targets = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ kind: "asset", assetId: i === 0 ? ASSET : `30000000-0000-4000-8000-${String(i).padStart(12, "0")}` }));
const CREATE = { reason: "Chiller 2 compressor overhaul", endsAt: "2026-11-13T18:00:00.000Z" };

/** Decision 1: the four ids, routes and risks; Q1: create and extend are red, end and cancel are not. */
export function theFourEntriesHaveTheirRoutesRisksAndColours(): void {
  expect(MAINTENANCE_WINDOW_IDS.map((id) => [entry(id).method, entry(id).path, entry(id).risk, entry(id).red ?? false])).toEqual([
    ["POST", "/maintenance-windows", "create", true],
    ["POST", "/maintenance-windows/:id/extend", "edit", true],
    ["POST", "/maintenance-windows/:id/end", "edit", false],
    ["POST", "/maintenance-windows/:id/cancel", "edit", false],
  ]);
}

/** Decision 2: the create names its body's targets; the three row entries the window the path names. */
export function theTargetsAreTheWindowKind(): void {
  expect(MAINTENANCE_WINDOW_IDS.map((id) => entry(id).target)).toEqual([
    { kind: "maintenanceWindow", field: "targets" },
    { kind: "maintenanceWindow", param: "id" },
    { kind: "maintenanceWindow", param: "id" },
    { kind: "maintenanceWindow", param: "id" },
  ]);
}

/** Q6: every copilot role (no `offeredTo`), proposed by the model, nothing typed on the card, no refs, no precondition. */
export function theEntriesAreEveryCopilotRolesAndTheModels(): void {
  for (const id of MAINTENANCE_WINDOW_IDS) {
    const e = entry(id);
    expect([e.offeredTo, e.proposer ?? "model", e.clientOnly, e.refs, e.precondition, e.fixedBody], id).toEqual([
      undefined,
      "model",
      [],
      [],
      undefined,
      undefined,
    ]);
  }
}

/** The route bodies by identity, and the create's model body by its export name. */
export function theBodiesAreTheRoutesExports(): void {
  const exports = contracts as unknown as Record<string, unknown>;
  for (const id of MAINTENANCE_WINDOW_IDS) expect(entry(id).body, id).toBe(exports[entry(id).bodyName ?? ""]);
  const create = entry("maintenanceWindow.create");
  expect(create.modelBodyName).toBe("copilotCreateMaintenanceWindowModelBodySchema");
  expect(create.modelBody).toBe(exports[create.modelBodyName ?? ""]);
}

/** Q4: a Copilot proposal names at most 25 targets; the route (the page's wizard) still takes 26, up to 200. */
export function theModelBodyRefuses26TargetsAndTheRouteTakesThem(): void {
  const create = entry("maintenanceWindow.create");
  expect(modelBodyOf(create).safeParse({ ...CREATE, targets: targets(25) }).success).toBe(true);
  expect(modelBodyOf(create).safeParse({ ...CREATE, targets: targets(26) }).success).toBe(false);
  expect(create.body.safeParse({ ...CREATE, targets: targets(26) }).success).toBe(true);
  expect(create.body.safeParse({ ...CREATE, targets: targets(200) }).success).toBe(true);
  // Strict, as the route body is: an unknown key is refused.
  expect(modelBodyOf(create).safeParse({ ...CREATE, targets: targets(1), suppress: false }).success).toBe(false);
}

/** Decision 1: the steps — Window, Targets, Link; New end; Reason; Reason. */
export function theStepsAreTheAmendments(): void {
  expect(MAINTENANCE_WINDOW_IDS.map((id) => entry(id).steps.map((step) => [step.id, [...step.fields]]))).toEqual([
    [
      ["window", ["reason", "startsAt", "endsAt"]],
      ["targets", ["targets"]],
      ["link", ["workOrderId", "maintenanceScheduleId"]],
    ],
    [["newEnd", ["endsAt", "reason"]]],
    [["reason", ["reason"]]],
    [["reason", ["reason"]]],
  ]);
}

/** Decisions 1, 3, 5: the create card names the organization, the period, every target, the covered count and the reason. */
export function theCreateSummaryNamesEverything(): void {
  const text = summary("maintenanceWindow.create", {
    body: { ...CREATE, targets: [{ kind: "asset", assetId: ASSET }, { kind: "location", locationId: ROW }] },
    params: {},
    targetName: "Pune Works",
  });
  expect(text).toBe(
    "Create a maintenance window in Pune Works from now to 2026-11-13 18:00 (UTC) on 2 targets: Chiller 2, Plant B; " +
      '"Plant B" covers 12 assets. Alarms on these targets are suppressed for that time: no alarm-bar count, popup, tone, ' +
      'notification or escalation. Reason: "Chiller 2 compressor overhaul".',
  );
}

/** A create with a start names it; with no location target there is no covered-asset clause. */
export function theCreateSummaryNamesItsStartAndNoCoverWithoutALocation(): void {
  const text = summary("maintenanceWindow.create", {
    body: { ...CREATE, startsAt: "2026-11-14T06:00:00.000Z", targets: targets(1) },
    params: {},
    maintenanceWindow: { ...WINDOW, targetLabels: ["Chiller 2"], locationLabels: [], coveredAssetCount: 0 },
  });
  expect(text).toContain("from 2026-11-14 06:00 (UTC) to 2026-11-13 18:00 (UTC) on 1 target: Chiller 2.");
  expect(text).not.toContain("covers");
}

/** The extend card names the window, its targets, the old and the new end, and the reason given. */
export function theExtendSummaryNamesTheWindowAndBothEnds(): void {
  expect(summary("maintenanceWindow.extend", { body: { endsAt: "2026-11-13T22:00:00.000Z", reason: "Parts late" } })).toBe(
    'Extend the maintenance window "Chiller 2 compressor overhaul" (Chiller 2, Plant B) from 2026-11-13 18:00 (UTC) ' +
      'to 2026-11-13 22:00 (UTC): alarms on its targets stay suppressed until then. Reason: "Parts late".',
  );
}

/** The end card says the suppressed alarms return; the cancel card names the start. Neither invents a reason. */
export function theEndAndCancelSummariesNameTheWindow(): void {
  expect(summary("maintenanceWindow.end")).toBe(
    'End the maintenance window "Chiller 2 compressor overhaul" (Chiller 2, Plant B) now: every alarm it suppresses that is still active ' +
      "returns as a normal alarm, with its popup, tone and notification.",
  );
  expect(summary("maintenanceWindow.cancel", { body: { reason: "Work postponed" } })).toBe(
    'Cancel the maintenance window "Chiller 2 compressor overhaul" (Chiller 2, Plant B) that starts at 2026-11-13 08:00 (UTC): it suppresses nothing. ' +
      'Reason: "Work postponed".',
  );
}

/**
 * `F4.360` defect 4: the summaries say an instant as a readable time with its zone, never the raw ISO string — UTC
 * on the card (the server passes no zone), the browser's zone on the page's Review (it passes `timeZone`).
 * Mutation: ignore `timeZone` → red.
 */
export function theSummariesSayTimesInTheGivenZone(): void {
  const timeZone = "Asia/Kolkata";
  expect(summary("maintenanceWindow.create", { body: { ...CREATE, targets: targets(1) }, params: {}, timeZone })).toContain(
    "from now to 2026-11-13 23:30 (UTC+05:30) on 1 target",
  );
  expect(summary("maintenanceWindow.extend", { body: { endsAt: "2026-11-13T22:00:00.000Z" }, timeZone })).toContain(
    "from 2026-11-13 23:30 (UTC+05:30) to 2026-11-14 03:30 (UTC+05:30):",
  );
  expect(summary("maintenanceWindow.cancel", { timeZone })).toContain("that starts at 2026-11-13 13:30 (UTC+05:30):");
  expect(summary("maintenanceWindow.cancel", { timeZone: "UTC" })).toContain("that starts at 2026-11-13 08:00 (UTC):");
  expect(summary("maintenanceWindow.cancel", { timeZone: "Mars/Olympus_Mons" })).toContain("that starts at 2026-11-13 08:00 (UTC):");
  // Daylight saving: New York's offset is the instant's own, on each side of the March switch.
  const ny = (startsAt: string) =>
    summary("maintenanceWindow.cancel", { timeZone: "America/New_York", maintenanceWindow: { ...WINDOW, startsAt } });
  expect(ny("2027-03-14T06:59:00.000Z")).toContain("that starts at 2027-03-14 01:59 (UTC-05:00):");
  expect(ny("2027-03-14T07:00:00.000Z")).toContain("that starts at 2027-03-14 03:00 (UTC-04:00):");
}

/**
 * `F4.362` leftover 3: the end and the cancel name the window's targets, as the extend does. The summary is the
 * propose tool's result, so a model that paraphrases it has the asset's name; with no labels there is no empty
 * "()" and no doubled space. Mutation: drop the clause from either summary → red.
 */
export function theEndAndCancelSummariesNameTheTargets(): void {
  const asset = { ...WINDOW, targetLabels: ["GOAT_Chiller_1"], locationLabels: [] };
  expect(summary("maintenanceWindow.end", { maintenanceWindow: asset })).toContain('"Chiller 2 compressor overhaul" (GOAT_Chiller_1) now:');
  expect(summary("maintenanceWindow.cancel", { maintenanceWindow: asset })).toContain('"Chiller 2 compressor overhaul" (GOAT_Chiller_1) that starts');
  const none = { ...WINDOW, targetLabels: [], locationLabels: [] };
  for (const id of ["maintenanceWindow.end", "maintenanceWindow.cancel"]) {
    const text = summary(id, { maintenanceWindow: none });
    expect(text, id).not.toContain("()");
    expect(text, id).not.toContain("  ");
  }
}

/**
 * `F4.362` leftover 1: the create stores its targets' names beside the body for the card's Targets row
 * (`targetLabels`, a `cardOnly` key: the hash leaves it out and the browser strips it before the write). The
 * row entries carry none: their bodies name no target.
 */
export function theCreateKeepsItsTargetNamesForTheCard(): void {
  expect(MAINTENANCE_WINDOW_IDS.map((id) => entry(id).cardOnly ?? [])).toEqual([["targetLabels"], [], [], []]);
}

/** Amendment 19 Consequences: the four routes left the exclusion list; nothing under `/maintenance-windows` stays there. */
export function noWindowRouteIsExcludedNow(): void {
  expect(MAINTENANCE_WINDOW_PENDING).toEqual([]);
  expect(EXCLUDED_ROUTES.filter((route) => route.path.startsWith("/maintenance-windows"))).toEqual([]);
}
