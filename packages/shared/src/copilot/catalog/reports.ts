import {
  copilotCreateReportScheduleModelBodySchema,
  copilotSaveEnergyReportFileModelBodySchema,
  createReportScheduleBodySchema,
  saveEnergyReportFileBodySchema,
  updateReportScheduleBodySchema,
} from "../../contracts/report-writes";
import { fieldList, plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry, CatalogTarget, ExcludedRoute } from "./types";

/**
 * `F4.280` (ADR 0099 Amendment 8, D2–D5, Q7, Q14; owner rulings 2026-10-24
 * Q1–Q8) — the report schedules (`report-schedules.controller.ts`) and the
 * on-demand file save (`POST /reports/energy/files`, `report-files.controller.ts`).
 *
 * D2: the three entries are offered to `admin`, `organization_admin` and
 * `location_admin`, the roles `assertMasterDataRole` admits (reached through
 * `writableLocationIds`); the targets mirror the routes' gates.
 *
 * D4 (Q2, Q3, Q5): a schedule's email delivery — `channelId` set, or
 * `enabled: true` on a schedule whose stored channel is set — is proposed only
 * in a user turn whose own message asked; the tools stay offered and the guard
 * is per field (`apps/api/src/copilot/copilot-propose-reports.ts`).
 *
 * D5: the two schedule entries store the card-only `recipients` (the channel's
 * name and every address in full), built by the server's proposal check
 * (`apps/api/src/reports/report-proposal-check.service.ts`), which also appends
 * a note with the channel name and the recipient count only. The summaries
 * here never name an address.
 *
 * Q14: the save renders inside the Confirm request, as on the page.
 */

const REPORT_ORG: CatalogTarget = { kind: "organization", manage: "report" };

/** The fields every entry here shares. */
const FOR_MASTER_DATA_ADMINS = {
  offeredTo: ["admin", "organization_admin", "location_admin"],
  refs: [],
  formulas: [],
  clientOnly: [],
} as const satisfies Partial<CatalogEntry>;

/** D4: the model is told when it may set the channel. */
const EMAIL_GUIDE =
  "Set channelId (email on every run, with no later Confirm) only when the user's own message asks for email delivery; otherwise leave it out.";

/** How many items an array field of the body holds. */
function countOf(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  return Array.isArray(value) ? value.length : 0;
}

/** The formats as a readable list ("pdf and xlsx"). */
function formatsOf(body: Readonly<Record<string, unknown>>): string {
  const formats = Array.isArray(body.formats) ? body.formats.filter((value): value is string => typeof value === "string") : [];
  if (formats.length === 0) return "a report";
  return formats.join(" and ");
}

export const REPORT_ENTRIES: readonly CatalogEntry[] = [
  {
    ...FOR_MASTER_DATA_ADMINS,
    id: "reportSchedule.create",
    title: "Create a report schedule",
    method: "POST",
    path: "/reports/schedules",
    params: {},
    body: createReportScheduleBodySchema,
    bodyName: "createReportScheduleBodySchema",
    modelBody: copilotCreateReportScheduleModelBodySchema,
    modelBodyName: "copilotCreateReportScheduleModelBodySchema",
    bodyGuide: EMAIL_GUIDE,
    cardOnly: ["recipients"],
    risk: "create",
    target: REPORT_ORG,
    steps: [
      {
        id: "schedule",
        title: "Schedule",
        fields: ["organizationId", "name", "formats", "cadence", "runAtLocal", "timezone", "enabled"],
      },
      { id: "scope", title: "Scope", fields: ["locationIds"] },
      { id: "delivery", title: "Delivery", fields: ["channelId"] },
    ],
    summary: ({ body, organizationName }) => {
      const locations = countOf(body, "locationIds");
      return (
        `Create the ${text(body, "cadence")} report schedule ${quoted(text(body, "name"))} in ${organizationName}: ` +
        `${formatsOf(body)} at ${text(body, "runAtLocal")} ${text(body, "timezone")}, ` +
        `${locations === 0 ? "the whole organization" : plural(locations, "location")}` +
        `${typeof body.channelId === "string" ? ", emailed to a channel on every run with no later Confirm" : ""}` +
        `${body.enabled === false ? ", created disabled" : ""}.`
      );
    },
  },
  {
    ...FOR_MASTER_DATA_ADMINS,
    id: "reportSchedule.update",
    title: "Edit a report schedule",
    method: "PATCH",
    path: "/reports/schedules/:id",
    params: { id: uuidParam },
    body: updateReportScheduleBodySchema,
    bodyName: "updateReportScheduleBodySchema",
    bodyGuide: EMAIL_GUIDE,
    cardOnly: ["recipients"],
    risk: "edit",
    target: { kind: "reportSchedule", param: "id" },
    steps: [
      { id: "schedule", title: "Schedule", fields: ["name", "formats", "cadence", "runAtLocal", "timezone", "enabled"] },
      { id: "scope", title: "Scope", fields: ["locationIds"] },
      { id: "delivery", title: "Delivery", fields: ["channelId"] },
    ],
    summary: ({ body, targetName }) =>
      `Change ${fieldList(body)} of the report schedule ${quoted(targetName)}.` +
      (body.enabled === false ? " It stops running." : "") +
      (body.channelId === null ? " Email delivery stops." : "") +
      (typeof body.channelId === "string" ? " It is emailed on every run with no later Confirm." : ""),
  },
  {
    ...FOR_MASTER_DATA_ADMINS,
    id: "reportFile.save",
    title: "Save an energy report to the history",
    method: "POST",
    path: "/reports/energy/files",
    params: {},
    body: saveEnergyReportFileBodySchema,
    bodyName: "saveEnergyReportFileBodySchema",
    modelBody: copilotSaveEnergyReportFileModelBodySchema,
    modelBodyName: "copilotSaveEnergyReportFileModelBodySchema",
    risk: "create",
    target: REPORT_ORG,
    steps: [{ id: "report", title: "Report", fields: ["organizationId", "startDate", "endDate", "format", "locationIds"] }],
    // `F4.290` (Amendment 9 E4): named sites are said; none says nothing about scope, because the
    // stamp then depends on the role (a location admin's grants), which the proposal check's note names.
    summary: ({ body, organizationName }) =>
      `Render the ${text(body, "format")} energy report for ${text(body, "startDate")} to ${text(body, "endDate")}` +
      (Array.isArray(body.locationIds) && body.locationIds.length > 0
        ? `, scoped to ${body.locationIds.length} location${body.locationIds.length === 1 ? "" : "s"},`
        : "") +
      ` and save it to the report history of ${organizationName}; the file is rendered when you confirm.`,
  },
];

const NO_DELETE = "a hard DELETE is never in the catalog (decision 3)";

/** The report routes that are not entries (Amendment 8, "Not in this amendment"). */
export const REPORT_PENDING: readonly ExcludedRoute[] = [
  { method: "DELETE", path: "/reports/schedules/:id", reason: NO_DELETE },
  { method: "DELETE", path: "/reports/files/:id", reason: NO_DELETE },
];
