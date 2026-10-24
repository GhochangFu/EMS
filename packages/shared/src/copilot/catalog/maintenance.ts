import {
  copilotActivateMaintenanceScheduleModelBodySchema,
  copilotDeactivateMaintenanceScheduleModelBodySchema,
  createMaintenanceScheduleBodySchema,
  updateMaintenanceScheduleBodySchema,
} from "../../contracts/maintenance-writes";
import { quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogStep, ExcludedRoute } from "./types";

/**
 * `F4.281` (ADR 0099 Amendment 8, D2, D3, D6, D7, Q15, Q16; owner rulings
 * 2026-10-24 DC1, DC5) — the maintenance schedules of the Schedule Centre
 * (`apps/api/src/maintenance/maintenance.controller.ts`).
 *
 * Three entries, offered to every copilot role (Q15): the routes' gate is the
 * `configuration` role class plus the schedule's (or the create body's) asset in
 * the caller's **read** scope, and the `maintenanceSchedule` target mirrors
 * exactly that (D2). The create's organization is its asset's.
 *
 * D3, owner ruling DC1: `activate` and `deactivate` are one entry per direction
 * on the PATCH. Each takes the optional reason (a Reason step, then Review), so
 * the audit row records why; its model body fixes `active` to the direction's
 * value. The deactivate is red. D6: no entry takes a precondition (the PATCH
 * accepts decision 4.9's residual). The convert route creates a work order and
 * is excluded (Amendment 8, "Not in this amendment").
 */

/** The fields every entry on one schedule row shares. */
const ON_A_SCHEDULE = {
  method: "PATCH",
  path: "/maintenance/schedules/:id",
  params: { id: uuidParam },
  body: updateMaintenanceScheduleBodySchema,
  bodyName: "updateMaintenanceScheduleBodySchema",
  clientOnly: [],
  target: { kind: "maintenanceSchedule", param: "id" },
  refs: [],
  formulas: [],
} as const satisfies Partial<CatalogEntry>;

/**
 * Owner ruling DC1: the Reason step. `active` sits in it too — the step gate
 * puts every body field in exactly one step — but each direction's model body
 * fixes it, and the page's toggle wizard sets it and never offers it.
 */
const REASON_STEP: readonly CatalogStep[] = [{ id: "reason", title: "Reason", fields: ["active", "reason"] }];

/** The reason the user gave, as the card's closing sentence; nothing without one. */
function reasonLine(body: Readonly<Record<string, unknown>>): string {
  const reason = text(body, "reason");
  return reason ? ` Reason: ${quoted(reason)}.` : "";
}

/** A number field of the body as text, or the fallback. */
function numberText(body: Readonly<Record<string, unknown>>, key: string, fallback: string): string {
  const value = body[key];
  return typeof value === "number" ? String(value) : fallback;
}

export const MAINTENANCE_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "maintenanceSchedule.create",
    title: "Create a maintenance schedule",
    method: "POST",
    path: "/maintenance/schedules",
    params: {},
    body: createMaintenanceScheduleBodySchema,
    bodyName: "createMaintenanceScheduleBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "maintenanceSchedule", field: "assetId" },
    refs: [],
    formulas: [],
    steps: [
      { id: "schedule", title: "Schedule", fields: ["assetId", "title", "description", "category", "generationMode", "priority"] },
      { id: "cycle", title: "Cycle", fields: ["intervalDays", "firstDueAt", "estimatedMinutes"] },
      { id: "details", title: "Details", fields: ["ownerTeam", "vendorName", "complianceRef", "triggerSummary", "safetyCritical"] },
    ],
    summary: ({ body, targetName, organizationName }) => {
      const complianceRef = text(body, "complianceRef");
      return (
        `Create the ${text(body, "category", "preventive")} maintenance schedule ${quoted(text(body, "title"))} ` +
        `on ${targetName} in ${organizationName}: every ${numberText(body, "intervalDays", "?")} days from ${text(body, "firstDueAt")}, ` +
        `priority ${text(body, "priority", "medium")}, about ${numberText(body, "estimatedMinutes", "60")} min` +
        `${body.safetyCritical === true ? ", safety-critical" : ""}` +
        `${complianceRef ? `, compliance ref ${quoted(complianceRef)}` : ""}.`
      );
    },
  },
  {
    ...ON_A_SCHEDULE,
    id: "maintenanceSchedule.activate",
    title: "Activate a maintenance schedule",
    modelBody: copilotActivateMaintenanceScheduleModelBodySchema,
    modelBodyName: "copilotActivateMaintenanceScheduleModelBodySchema",
    risk: "edit",
    steps: REASON_STEP,
    summary: ({ body, targetName }) =>
      `Activate the maintenance schedule ${quoted(targetName)}: it returns to the default Schedule Centre list and work orders can be generated from it again.${reasonLine(body)}`,
  },
  {
    ...ON_A_SCHEDULE,
    id: "maintenanceSchedule.deactivate",
    title: "Deactivate a maintenance schedule",
    modelBody: copilotDeactivateMaintenanceScheduleModelBodySchema,
    modelBodyName: "copilotDeactivateMaintenanceScheduleModelBodySchema",
    risk: "deactivate",
    steps: REASON_STEP,
    summary: ({ body, targetName }) =>
      `Deactivate the maintenance schedule ${quoted(targetName)}: it leaves the default Schedule Centre list and no work order is generated from it until it is activated again.${reasonLine(body)}`,
  },
];

/** The maintenance routes that are not entries, and why (Amendment 8, "Not in this amendment"; ADR 0106 Q6 brings it back). */
export const MAINTENANCE_PENDING: readonly ExcludedRoute[] = [
  { method: "POST", path: "/maintenance/schedules/:id/convert", reason: "creates a work order; ADR 0099 decision 1" },
];
