import { z } from "zod";

import type { LocationSummaryRow } from "../../reports/location-summary.service";
import { energyReportRange } from "../../reports/reports.service";
import { CURSOR_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_RANGE_MAX_DAYS } from "./copilot-time-range";
import { COPILOT_TOOL_LIST_MAX_ITEMS, COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET, locationRefusal } from "./copilot-tool-scope";
import { refineReportDates } from "./get-energy-report-preview.tool";

const DAY_MS = 86_400_000;

export const COPILOT_SUMMARY_RANGE_NEEDED = "give lastDays, or both startDate and endDate";
export const COPILOT_SUMMARY_RANGE_BOTH = "give lastDays or startDate/endDate, not both";

/** The calendar dates a call reads: as given, or `lastDays` whole UTC days ending on the turn's own date. */
export function summaryDays(
  args: { readonly startDate?: string; readonly endDate?: string; readonly lastDays?: number },
  now: Date,
): { startDate: string; endDate: string } {
  if (args.lastDays === undefined) return { startDate: args.startDate as string, endDate: args.endDate as string };
  const end = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { startDate: date(end - (args.lastDays - 1) * DAY_MS), endDate: date(end) };
}

/**
 * `get_location_summary` (`F4.290` PR 2, ADR 0099 Amendment 9 E4) — one row
 * per site over a date range (`LocationSummaryService`), so "a summary
 * report for all locations" is one call, not one report per site.
 *
 * **Rows.** No `locationIds` (owner ruling 2026-10-29): the top-level sites
 * the caller can read, the roots of its readable scope, each rolled up over
 * its subtree. `locationIds` (≤ 25, one organization): those sites, placed by
 * the shared location helper (`readPerOrganization`, owner ruling P5), so a
 * site not found is refused as F4.290 PR 1's 400 is and one outside the
 * grant as its 403 is (owner ruling 2026-10-29); sites holding no readable
 * asset are refused (owner ruling P6). A named site that only CONTAINS the
 * caller's grant (an ancestor) is refused too: the service names only
 * locations the caller reads (the plan critic's scope-leak fix).
 *
 * **Range.** The report's calendar dates (`startDate`..`endDate`, at most 31
 * days, the checks `get_energy_report_preview` applies) or `lastDays` (1–31,
 * ruling P3: the model has no date), which the server turns into whole UTC
 * days ending on the turn's own date (`ctx.now`). Calendar dates, not P3's
 * `from`/`to` instants, because a row's kWh is the report's expression over
 * the report's bounds: UTC day boundaries are `_1h` bucket boundaries (no
 * partial edge bucket, ADR 0025), and a row equals the energy report
 * preview of the same site and dates.
 *
 * **Paging** (`F4.296`: a site-wide read must answer inside one turn). The
 * rows are an offset list under F4.291's one opaque cursor (no second
 * cursor shape); a row is compact (measured: 13 seeded-length rows are a
 * 3,593-character result; a row at every column's maximum is 511, so a
 * worst-case page holds 14), so a normal estate (ESKOM 13 roots, PHE 6) is
 * one call, and `fitListResult` ends a page of wider rows at the result
 * budget with the cursor after its last kept row.
 */
export const getLocationSummaryTool = defineReadTool({
  name: "get_location_summary",
  description:
    "One row per site for a date range: the top-level locations you can read, or the given locationIds (up to 25 of one organization), " +
    "each with its descendants: asset count, kWh (null without kW data), alarms raised in the range and still open by severity, assets with no data. " +
    `startDate..endDate (YYYY-MM-DD, at most 31 days) or lastDays (1-31); ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationIds: z.array(z.string().uuid()).min(1).max(COPILOT_TOOL_LIST_MAX_ITEMS).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      lastDays: z.number().int().min(1).max(COPILOT_RANGE_MAX_DAYS).optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      const add = (message: string, path: string) => issue.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      if (args.lastDays !== undefined) {
        if (args.startDate !== undefined || args.endDate !== undefined) add(COPILOT_SUMMARY_RANGE_BOTH, "lastDays");
        return;
      }
      if (args.startDate === undefined || args.endDate === undefined) {
        add(COPILOT_SUMMARY_RANGE_NEEDED, args.startDate === undefined ? "startDate" : "endDate");
        return;
      }
      refineReportDates({ startDate: args.startDate, endDate: args.endDate }, issue);
    }),
  async run(services, args, ctx) {
    const days = summaryDays(args, ctx.now);
    const range = energyReportRange(days);
    const scopeLocationIds = await services.access.readableLocationIds(ctx.user);
    const scope = {
      organizationId: args.organizationId,
      locationIds: args.locationIds,
      emptyLocations: args.locationIds === undefined ? undefined : COPILOT_TOOL_LOCATIONS_HOLD_NO_READABLE_ASSET,
      paging: { cursor: args.cursor, key: offsetKeySchema },
    };
    return readPerOrganization<LocationSummaryRow, number>(services, ctx, scope, async (organizationId, assetIds, room, resume) => {
      const rows = await services.locationSummary.rows(organizationId, scopeLocationIds, args.locationIds);
      if (!rows.ok) return { refusal: locationRefusal(rows.reason) };
      const offered = offsetPage(rows.rows, resume, room);
      const items = await services.locationSummary.summarise(organizationId, offered.items, assetIds, range);
      return { ...offered, items, extra: { ...days, locationCount: rows.rows.length } };
    });
  },
});
