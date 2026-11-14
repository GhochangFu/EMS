import {
  closeMaintenanceWindowBodySchema,
  copilotCreateMaintenanceWindowModelBodySchema,
  createMaintenanceWindowBodySchema,
  extendMaintenanceWindowBodySchema,
} from "../../contracts/maintenance-windows";
import { instantText, plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogSummaryInput, ExcludedRoute } from "./types";

/**
 * `F4.359` PR 6 (ADR 0099 Amendment 19; ADR 0131 decisions 2 and 16) — the
 * four maintenance-window writes (`apps/api/src/maintenance-windows/`).
 *
 * Every copilot role is offered them (Q6): the routes' gate is the
 * `configuration` role class plus the window's targets in the caller's read
 * scope, and the `maintenanceWindow` target calls that same scope check. The
 * create and the extend silence alarms, so they are red (Q1) and offered only
 * when the user's own message asks (Q2, `copilot-maintenance-window-intent.ts`).
 * The model proposes the reason, the card shows it and the change hash binds it
 * (Q7). A Copilot create names at most 25 targets (Q4,
 * `copilotCreateMaintenanceWindowModelBodySchema`); the route keeps 200.
 */

/** Plan PR 2 kept the four routes here until this build; they are entries now, so the list is empty. */
export const MAINTENANCE_WINDOW_PENDING: readonly ExcludedRoute[] = [];

type Window = NonNullable<CatalogSummaryInput["maintenanceWindow"]>;

/** The reason the user gave for a change of an existing window, as the card's closing sentence; nothing without one. */
function reasonLine(body: Readonly<Record<string, unknown>>): string {
  const reason = text(body, "reason");
  return reason ? ` Reason: ${quoted(reason)}.` : "";
}

/** Decision 3 (Q5): the location targets and the assets they cover now. */
function coverClause(window: Window | undefined): string {
  if (window === undefined || window.locationLabels.length === 0) return "";
  const names = window.locationLabels.map(quoted).join(", ");
  return `; ${names} ${window.locationLabels.length === 1 ? "covers" : "cover"} ${plural(window.coveredAssetCount, "asset")}`;
}

/** `F4.360` defect 4: a body time as the card says it, in the input's zone (UTC when none); the fallback as it is. */
function timeIn(body: Readonly<Record<string, unknown>>, key: string, timeZone: string | undefined, fallback = ""): string {
  const value = text(body, key);
  return value === "" ? fallback : instantText(value, timeZone);
}

/** The fields every entry on one window row shares. */
const ON_A_WINDOW = {
  method: "POST",
  params: { id: uuidParam },
  clientOnly: [],
  target: { kind: "maintenanceWindow", param: "id" },
  refs: [],
  formulas: [],
} as const satisfies Partial<CatalogEntry>;

export const MAINTENANCE_WINDOW_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "maintenanceWindow.create",
    title: "Create a maintenance window",
    method: "POST",
    path: "/maintenance-windows",
    params: {},
    body: createMaintenanceWindowBodySchema,
    bodyName: "createMaintenanceWindowBodySchema",
    modelBody: copilotCreateMaintenanceWindowModelBodySchema,
    modelBodyName: "copilotCreateMaintenanceWindowModelBodySchema",
    clientOnly: [],
    risk: "create",
    red: true,
    target: { kind: "maintenanceWindow", field: "targets" },
    refs: [],
    formulas: [],
    steps: [
      { id: "window", title: "Window", fields: ["reason", "startsAt", "endsAt"] },
      { id: "targets", title: "Targets", fields: ["targets"] },
      { id: "link", title: "Link", fields: ["workOrderId", "maintenanceScheduleId"] },
    ],
    summary: ({ body, organizationName, maintenanceWindow, timeZone }) => {
      const labels = maintenanceWindow?.targetLabels ?? [];
      const count = Array.isArray(body.targets) ? body.targets.length : labels.length;
      return (
        `Create a maintenance window in ${organizationName} from ${timeIn(body, "startsAt", timeZone, "now")} to ${timeIn(body, "endsAt", timeZone)} ` +
        `on ${plural(count, "target")}${labels.length > 0 ? `: ${labels.join(", ")}` : ""}${coverClause(maintenanceWindow)}. ` +
        "Alarms on these targets are suppressed for that time: no alarm-bar count, popup, tone, notification or escalation. " +
        `Reason: ${quoted(text(body, "reason"))}.`
      );
    },
  },
  {
    ...ON_A_WINDOW,
    id: "maintenanceWindow.extend",
    title: "Extend a maintenance window",
    path: "/maintenance-windows/:id/extend",
    body: extendMaintenanceWindowBodySchema,
    bodyName: "extendMaintenanceWindowBodySchema",
    risk: "edit",
    red: true,
    steps: [{ id: "newEnd", title: "New end", fields: ["endsAt", "reason"] }],
    summary: ({ body, targetName, maintenanceWindow, timeZone }) => {
      const labels = maintenanceWindow?.targetLabels ?? [];
      const currentEnd = maintenanceWindow?.endsAt;
      return (
        `Extend the maintenance window ${quoted(targetName)}${labels.length > 0 ? ` (${labels.join(", ")})` : ""} ` +
        `from ${currentEnd ? instantText(currentEnd, timeZone) : "its current end"} to ${timeIn(body, "endsAt", timeZone)}: ` +
        `alarms on its targets stay suppressed until then.${reasonLine(body)}`
      );
    },
  },
  {
    ...ON_A_WINDOW,
    id: "maintenanceWindow.end",
    title: "End a maintenance window",
    path: "/maintenance-windows/:id/end",
    body: closeMaintenanceWindowBodySchema,
    bodyName: "closeMaintenanceWindowBodySchema",
    risk: "edit",
    steps: [{ id: "reason", title: "Reason", fields: ["reason"] }],
    summary: ({ body, targetName }) =>
      `End the maintenance window ${quoted(targetName)} now: every alarm it suppresses that is still active returns as a ` +
      `normal alarm, with its popup, tone and notification.${reasonLine(body)}`,
  },
  {
    ...ON_A_WINDOW,
    id: "maintenanceWindow.cancel",
    title: "Cancel a maintenance window",
    path: "/maintenance-windows/:id/cancel",
    body: closeMaintenanceWindowBodySchema,
    bodyName: "closeMaintenanceWindowBodySchema",
    risk: "edit",
    steps: [{ id: "reason", title: "Reason", fields: ["reason"] }],
    summary: ({ body, targetName, maintenanceWindow, timeZone }) => {
      const startsAt = maintenanceWindow?.startsAt;
      return `Cancel the maintenance window ${quoted(targetName)}${startsAt ? ` that starts at ${instantText(startsAt, timeZone)}` : ""}: it suppresses nothing.${reasonLine(body)}`;
    },
  },
];
