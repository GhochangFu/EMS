import {
  alarmAckBodySchema,
  alarmEnrichmentUpsertBodySchema,
  closeWorkOrderBodySchema,
  copilotAlarmEnrichmentModelBodySchema,
  copilotWorkOrderSetStatusModelBodySchema,
  createWorkOrderBodySchema,
  reorderWorkOrdersBodySchema,
  updateWorkOrderStatusBodySchema,
} from "../../contracts/operations-writes";
import { plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogSummaryInput } from "./types";

/**
 * `F4.284` (ADR 0106; ADR 0099 Amendment 8 D2, "Common to every entry") — the
 * alarm and work-order writes (`apps/api/src/alarms/alarms.controller.ts`,
 * `apps/api/src/work-orders/work-orders.controller.ts`).
 *
 * Six entries, offered to every copilot role (ADR 0106 Q1): each route's gate is
 * the `operational` role class plus the row's (or the create body's) asset in the
 * caller's **read** scope, and the `alarm`, `workOrder` and `workOrderBatch`
 * targets mirror exactly that (D2).
 *
 * - Decisions 3 and 4: the acknowledge and the close are risk `operational` (red,
 *   "cannot be undone"), proposed in the user's own message only
 *   (`apps/api/src/copilot/copilot-operations-intent.ts`); the reason is in the
 *   body, so the hash binds it.
 * - Decision 2: the status entry's model body leaves out `closed`
 *   (`copilotWorkOrderSetStatusModelBodySchema`), so a close goes through its own
 *   route with a reason.
 * - Owner ruling DC2 (2026-10-24): `workOrder.reorder` is a canvas entry — the
 *   Kanban drag is its form — and its card lists every moved work order from the
 *   card-only `moves` the propose step stores (left out of the hash).
 * - Owner ruling 2026-10-25 (Q4), replacing DC4: the enrichment model body
 *   carries `skillCode`; `list_alarm_skills` lists the active codes, and the
 *   `alarmSkill` ref refuses an unknown or retired one before the card.
 * - No entry takes a precondition: the PATCHes accept decision 4.9's residual.
 */

/** The reason the user gave, as the card's closing sentence; nothing without one. */
function reasonLine(body: Readonly<Record<string, unknown>>): string {
  const reason = text(body, "reason");
  return reason ? ` Reason: ${quoted(reason)}.` : "";
}

/** The alarm as the card names it: its text, severity, asset and raised time (ADR 0106 decision 3). */
function alarmPhrase({ alarm, targetName }: CatalogSummaryInput): string {
  if (!alarm) return `the alarm on ${targetName}`;
  return `the ${alarm.severity} alarm ${quoted(alarm.message)} on ${alarm.assetName || targetName}, raised ${alarm.raisedAt}`;
}

/** A status as a card shows it: `in_progress` reads "in progress". */
function statusText(status: string): string {
  return status.replace(/_/g, " ");
}

export const OPERATIONS_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "alarm.acknowledge",
    title: "Acknowledge an alarm",
    method: "POST",
    path: "/alarms/:id/ack",
    params: { id: uuidParam },
    body: alarmAckBodySchema,
    bodyName: "alarmAckBodySchema",
    clientOnly: [],
    risk: "operational",
    target: { kind: "alarm", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "reason", title: "Reason", fields: ["reason"] }],
    summary: (input) => `Acknowledge ${alarmPhrase(input)}.${reasonLine(input.body)}`,
  },
  {
    id: "alarm.enrichment.set",
    title: "Record an alarm analysis",
    method: "PUT",
    path: "/alarms/:id/enrichment",
    params: { id: uuidParam },
    body: alarmEnrichmentUpsertBodySchema,
    bodyName: "alarmEnrichmentUpsertBodySchema",
    modelBody: copilotAlarmEnrichmentModelBodySchema,
    modelBodyName: "copilotAlarmEnrichmentModelBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "alarm", param: "id" },
    // `affectedAssetIds` is an array: the resolver checks each id (read scope, the alarm's organization).
    // Owner ruling 2026-10-25 (Q4): `skillCode` is an active `bms.alarm_skills` code (the route's `assertAlarmSkill`).
    refs: [{ field: "skillCode", kind: "alarmSkill" }],
    formulas: [],
    steps: [
      { id: "analysis", title: "Analysis", fields: ["rootCause", "impact", "correctiveActions"] },
      { id: "impacts", title: "Impacts", fields: ["energyImpact", "waterImpact", "productionImpact"] },
      { id: "details", title: "Details", fields: ["etrAt", "skillCode", "affectedAssetIds"] },
    ],
    summary: (input) => {
      const affected = Array.isArray(input.body.affectedAssetIds) ? input.body.affectedAssetIds.length : null;
      const fields = Object.keys(input.body).filter((key) => key !== "affectedAssetIds");
      return (
        `Record the analysis of ${alarmPhrase(input)}: ${fields.length > 0 ? fields.join(", ") : "no text fields"}` +
        `${affected === null ? "" : `, ${plural(affected, "affected asset")}`}.`
      );
    },
  },
  {
    id: "workOrder.create",
    title: "Create a work order",
    method: "POST",
    path: "/work-orders",
    params: {},
    body: createWorkOrderBodySchema,
    bodyName: "createWorkOrderBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "workOrder", field: "assetId" },
    refs: [
      { field: "alarmId", kind: "alarm" },
      { field: "assignedTo", kind: "user" },
    ],
    formulas: [],
    steps: [
      { id: "work", title: "Work", fields: ["assetId", "alarmId", "title", "description", "priority"] },
      { id: "assignment", title: "Assignment", fields: ["assignedTo", "dueAt"] },
    ],
    summary: ({ body, targetName, organizationName, refName }) => {
      const due = text(body, "dueAt");
      return (
        `Create the ${text(body, "priority", "medium")} priority work order ${quoted(text(body, "title"))} on ${targetName} in ${organizationName}` +
        `${typeof body.alarmId === "string" ? ", linked to its alarm" : ""}` +
        `${refName ? `, assigned to ${refName}` : typeof body.assignedTo === "string" ? ", with an assignee" : ""}${due ? `, due ${due}` : ""}.`
      );
    },
  },
  {
    id: "workOrder.setStatus",
    title: "Change a work order status",
    method: "PATCH",
    path: "/work-orders/:id/status",
    params: { id: uuidParam },
    body: updateWorkOrderStatusBodySchema,
    bodyName: "updateWorkOrderStatusBodySchema",
    modelBody: copilotWorkOrderSetStatusModelBodySchema,
    modelBodyName: "copilotWorkOrderSetStatusModelBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "workOrder", param: "id" },
    refs: [{ field: "assignedTo", kind: "user" }],
    formulas: [],
    steps: [{ id: "status", title: "Status", fields: ["status", "reason", "sortOrder", "assignedTo"] }],
    summary: ({ body, targetName, workOrder, refName }) => {
      const from = workOrder ? ` from ${statusText(workOrder.status)}` : "";
      const assignee =
        body.assignedTo === null
          ? ", and clear its assignee"
          : refName
            ? `, assigned to ${refName}`
            : typeof body.assignedTo === "string"
              ? ", with a new assignee"
              : "";
      return `Move the work order ${quoted(targetName)}${from} to ${statusText(text(body, "status"))}${assignee}.${reasonLine(body)}`;
    },
  },
  {
    id: "workOrder.close",
    title: "Close a work order",
    method: "POST",
    path: "/work-orders/:id/close",
    params: { id: uuidParam },
    body: closeWorkOrderBodySchema,
    bodyName: "closeWorkOrderBodySchema",
    clientOnly: [],
    risk: "operational",
    target: { kind: "workOrder", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "reason", title: "Reason", fields: ["reason", "sortOrder"] }],
    summary: ({ body, targetName, workOrder }) =>
      `Close the work order ${quoted(targetName)}${workOrder ? ` (now ${statusText(workOrder.status)}, on ${workOrder.assetName})` : ""}.${reasonLine(body)}`,
  },
  {
    id: "workOrder.reorder",
    title: "Reorder work orders",
    method: "PATCH",
    path: "/work-orders/reorder",
    params: {},
    body: reorderWorkOrdersBodySchema,
    bodyName: "reorderWorkOrdersBodySchema",
    clientOnly: [],
    // Owner ruling DC2: the card lists each moved work order, old and new position; never hashed.
    cardOnly: ["moves"],
    risk: "edit",
    target: { kind: "workOrderBatch", field: "items" },
    refs: [],
    formulas: [],
    // Owner ruling DC2: a canvas entry (the Kanban board) has no steps.
    steps: [],
    summary: ({ body, organizationName }) => {
      const count = Array.isArray(body.items) ? body.items.length : 0;
      return `Reorder ${plural(count, "work order")} in ${organizationName}; the card lists each one with its old and new position.${reasonLine(body)}`;
    },
  },
];
