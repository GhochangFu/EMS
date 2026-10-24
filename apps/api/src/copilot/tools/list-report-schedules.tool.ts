import { reportScheduleListResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { collectByOrganization, defineReadTool } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, targetOrganizations } from "./copilot-tool-scope";

/**
 * `ReportSchedulesService.list` reads through `reportFileReadScope`, which
 * refuses every role but `admin`, `organization_admin` and `location_admin`;
 * the tool refuses the others up front — the `list_locations` refusal pattern.
 */
export const COPILOT_REPORT_SCHEDULES_ROLE_REFUSAL =
  "Your role cannot list report schedules; an organization or location admin manages them.";

const mayListSchedules = (role: string): boolean =>
  role === "admin" || role === "organization_admin" || role === "location_admin";

/**
 * `list_report_schedules` (`F4.280`, ADR 0099 Amendment 8 D7; owner ruling Q1)
 * — the Reports page's own read (`ReportSchedulesService.list`, already
 * filtered to the caller's scope), called once, so the model looks a
 * schedule's id up for `reportSchedule.update` rather than guessing it. Rows of
 * an organization outside the turn's allowed set are dropped; rows are grouped
 * by organization, and `search` (name) narrows **before** the 25-item cap.
 *
 * A row carries `channelId` and `locationCount`, never an address (the DTO has
 * none) and never the stamped location ids.
 */
export const listReportSchedulesTool = defineReadTool({
  name: "list_report_schedules",
  description:
    "List report schedules (id, name, cadence, runAtLocal, timezone, formats, enabled, nextRunAt, locationCount, " +
    "channelId). Optional organizationId and search (name) narrow the list; truncated means there are more.",
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      search: z.string().min(1).max(64).optional(),
    })
    .strict(),
  async run({ schedules }, args, ctx) {
    if (!mayListSchedules(ctx.identity.role)) return { ok: false, error: COPILOT_REPORT_SCHEDULES_ROLE_REFUSAL };
    const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
    if (!target.ok) return target;
    const rows = parseStoredContract(
      reportScheduleListResponseSchema,
      await schedules.list(ctx.user),
      "copilot_tools.list_report_schedules.page",
    );
    const needle = args.search?.toLowerCase();
    const out = collectByOrganization<Record<string, unknown>>();
    let room = COPILOT_TOOL_LIST_MAX_ITEMS;
    let truncated = false;
    for (const organizationId of target.ids) {
      const matching = rows.filter(
        (row) => row.organizationId === organizationId && (needle === undefined || row.name.toLowerCase().includes(needle)),
      );
      if (matching.length > room) truncated = true;
      room -= out.add(
        organizationId,
        matching.map((row) => ({
          id: row.id,
          name: row.name,
          cadence: row.cadence,
          runAtLocal: row.runAtLocal,
          timezone: row.timezone,
          formats: row.formats,
          enabled: row.enabled,
          nextRunAt: row.nextRunAt,
          locationCount: row.locationIds.length,
          channelId: row.channelId,
        })),
        room,
      );
    }
    return { ok: true, result: { organizations: out.organizations, truncated }, organizationIds: out.read };
  },
});
