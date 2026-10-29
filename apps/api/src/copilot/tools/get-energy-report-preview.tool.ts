import { energyReportPreviewSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { isCalendarDate } from "../../reports/report-files.schema";
import { energyReportQuerySchema } from "../../reports/reports.schema";
import { LOCATION_ID_PHRASE } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_TOOL_LIST_MAX_ITEMS, COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET } from "./copilot-tool-scope";

/** The service's own limit (`ReportsService.parseRange`): 31 whole days. */
export const COPILOT_REPORT_MAX_DAYS = 31;

const DAY_MS = 86_400_000;

/**
 * The room one organization entry takes (range, summary, source totals: about
 * three consumer rows of JSON), so 25 items bound the result below the
 * 8,000-character tool-result cut however many organizations are allowed.
 */
export const COPILOT_REPORT_ENTRY_COST = 3;

/**
 * `get_energy_report_preview` (`F4.275`) — `ReportsService.energyPreview`, the
 * `GET /reports/energy/preview` read behind the `/sustainability` report panel,
 * once per organization. The range is checked by the schema before any read
 * (the service answers 400 on the same faults; `isCalendarDate` also refuses
 * the `2026-02-30` roll the route admits). The result drops the report
 * `template` and the fixed `notes` (the DG caveat is in the description);
 * the top consumers are the items.
 *
 * `F4.290` (ADR 0099 Amendment 9 E4; owner ruling P6): `locationIds`, at most
 * 25 sites of one organization (the route takes 200), read through the one
 * shared location helper as `locationId` is; sites whose subtrees hold no
 * asset the caller reads are refused before any read. `locationId` and
 * `locationIds` together are refused by the schema.
 */
export const getEnergyReportPreviewTool = defineReadTool({
  name: "get_energy_report_preview",
  description:
    "Read the energy report per organization for startDate..endDate (YYYY-MM-DD, at most 31 days): total kWh, cost, kWh per source (DG is a nominal slice), " +
    "and the top 10 assets by kWh, each with its site name (not a per-site total). " +
    `Optional organizationId or ${LOCATION_ID_PHRASE} narrows the read; ` +
    "or locationIds (up to 25 site ids of one organization from list_locations, each with its descendants) for a report of those sites.",
  schema: energyReportQuerySchema
    .extend({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      locationIds: z.array(z.string().uuid()).min(1).max(COPILOT_TOOL_LIST_MAX_ITEMS).optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      if (args.locationId !== undefined && args.locationIds !== undefined) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["locationIds"], message: "give locationId or locationIds, not both" });
      }
      const startOk = isCalendarDate(args.startDate);
      const endOk = isCalendarDate(args.endDate);
      if (!startOk) issue.addIssue({ code: z.ZodIssueCode.custom, path: ["startDate"], message: "not a calendar date" });
      if (!endOk) issue.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "not a calendar date" });
      if (!startOk || !endOk) return;
      const days = (Date.parse(args.endDate) - Date.parse(args.startDate)) / DAY_MS + 1;
      if (days < 1) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "is before startDate" });
      } else if (days > COPILOT_REPORT_MAX_DAYS) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: `range is over ${COPILOT_REPORT_MAX_DAYS} days` });
      }
    }),
  async run(services, args, ctx) {
    const query = { startDate: args.startDate, endDate: args.endDate };
    const scope = {
      organizationId: args.organizationId,
      locationId: args.locationId,
      locationIds: args.locationIds,
      emptyLocations: args.locationIds === undefined ? undefined : COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET,
    };
    return readPerOrganization(services, ctx, scope, async (_organizationId, assetIds) => {
      const preview = parseStoredContract(
        energyReportPreviewSchema,
        await services.reports.energyPreview(query, [...assetIds]),
        "copilot_tools.get_energy_report_preview.result",
      );
      return {
        items: preview.topConsumers,
        extra: { range: preview.range, summary: preview.summary, sourceTotals: preview.sourceTotals },
        entryCost: COPILOT_REPORT_ENTRY_COST,
      };
    });
  },
});
