import { alarmStatsSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { LOCATION_ID_PHRASE, listCursorSchema } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_RANGE_MAX_DAYS, refineInstantRange, resolveInstantRange, timeRangeFields } from "./copilot-time-range";
import { COPILOT_TOOL_LIST_MAX_ITEMS } from "./copilot-tool-scope";

/**
 * `get_alarm_stats` (`F4.291` PR 2, ADR 0099 Amendment 9 E5(b)) —
 * `AlarmStatsService.range` over one organization's readable asset ids (or a
 * location's readable subtree ids, through `readPerOrganization`), never
 * `null` and never `[]`. The range is `lastDays` (1–31, resolved on the
 * turn's clock; owner ruling P3) or `from`/`to` of at most 31 days, checked
 * before any read.
 *
 * One organization fills a call: its entry (25 locations and 10 assets is
 * about 5,000 characters) costs the whole item room (`entryCost`), so two
 * would pass the 8,000-character result cut. The next organization is
 * reached by `nextCursor`, which names it (no resume key: an organization's
 * statistics are one entry). The answer is parsed through `alarmStatsSchema`
 * (an extra key is stripped; a bad row is the stored-contract error).
 */
export const getAlarmStatsTool = defineReadTool({
  name: "get_alarm_stats",
  description:
    "Alarm statistics for lastDays (1-31) or from..to (ISO instants, at most 31 days): raised and open counts by severity and by location, " +
    "the top 10 assets, mean seconds to acknowledge and to clear. One organization per call; a non-null nextCursor reaches the next. " +
    `Optional organizationId or ${LOCATION_ID_PHRASE}.`,
  schema: z
    .object({
      organizationId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      ...timeRangeFields,
      cursor: listCursorSchema.optional(),
    })
    .strict()
    .superRefine((args, issue) => refineInstantRange(args, issue, { maxDays: COPILOT_RANGE_MAX_DAYS, required: true })),
  async run(services, args, ctx) {
    const range = resolveInstantRange(args, ctx.now);
    if (!range.ok) return range;
    const { from, to } = range;
    if (from === undefined || to === undefined) throw new Error("F4.291: get_alarm_stats resolved an open range past its schema");
    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: z.never() } };
    return readPerOrganization<never, never>(services, ctx, scope, async (_organizationId, assetIds) => ({
      items: [],
      extra: parseStoredContract(alarmStatsSchema, await services.alarmStats.range([...assetIds], from, to), "copilot_tools.get_alarm_stats.result"),
      entryCost: COPILOT_TOOL_LIST_MAX_ITEMS,
    }));
  },
});
