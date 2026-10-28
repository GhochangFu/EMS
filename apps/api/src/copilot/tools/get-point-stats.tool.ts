import { POINT_STATS_MAX_ASSETS, pointStatsByAssetSchema, type PointStatsRow } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { pointKeySchema } from "../../telemetry/telemetry.schema";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { collectByOrganization, defineReadTool, listResult, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_RANGE_MAX_DAYS, refineInstantRange, resolveInstantRange, timeRangeFields } from "./copilot-time-range";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationsOfAssets, targetOrganizations } from "./copilot-tool-scope";

export const COPILOT_POINT_STATS_ONE_SOURCE = "give exactly one of locationId or assetIds";
export const COPILOT_POINT_STATS_CURSOR_NEEDS_LOCATION = "cursor pages a locationId read; assetIds is one page";

/**
 * `get_point_stats` (`F4.291` PR 3, ADR 0099 Amendment 9 E5(c); owner
 * rulings P3, P6) — `TelemetryService.pointStatsByAsset`: one point key over
 * many assets for `lastDays` (1–31, resolved on the turn's clock) or
 * `from`/`to` of at most 31 days: min / mean / max / sample count per asset,
 * and `last`, the newest 1-minute bucket's mean.
 *
 * `telemetry.*` has no Row Level Security, so every id is placed first:
 *
 * - `assetIds` (1–25, the model's): `organizationsOfAssets` over the target
 *   organizations, one unplaced id refuses the whole call (the F4.274 rule);
 *   one service call per organization with that organization's ids. One
 *   page (no cursor): the 25-asset bound is the schema's.
 * - `locationId`: `readPerOrganization` turns the site into the caller's
 *   readable subtree ids (sorted by id), and the offset cursor pages them 25
 *   at a time.
 *
 * Every asked asset is in `items`, in the asked order: one the service did
 * not answer (no sample in the window) as null stats and `sampleCount: 0`, so
 * the model is never told "no data" by a missing row; a row for an asset not
 * asked is dropped. Both branches return through `fitListResult` (the
 * `F4.291` live-check path, `truncated` and `nextCursor` first); a page of 25
 * worst-case rows stays well under the budget
 * (`point-stats-read-tools.spec.ts`). The service is never called with `[]`.
 */
export const getPointStatsTool = defineReadTool({
  name: "get_point_stats",
  description:
    "One point key over many assets for lastDays (1-31) or from..to (ISO instants, at most 31 days): min, mean, max, last (newest minute) " +
    `and sample count per asset; no data is null. Give ${LOCATION_ID_PHRASE}, with ${CURSOR_PHRASE}, or assetIds (1-25). Optional organizationId.`,
  schema: z
    .object({
      pointKey: pointKeySchema,
      ...timeRangeFields,
      locationId: z.string().uuid().optional(),
      assetIds: z.array(z.string().uuid()).min(1).max(POINT_STATS_MAX_ASSETS).optional(),
      organizationId: z.string().uuid().optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      if ((args.locationId === undefined) === (args.assetIds === undefined)) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["locationId"], message: COPILOT_POINT_STATS_ONE_SOURCE });
      }
      if (args.cursor !== undefined && args.assetIds !== undefined) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["cursor"], message: COPILOT_POINT_STATS_CURSOR_NEEDS_LOCATION });
      }
      refineInstantRange(args, issue, { maxDays: COPILOT_RANGE_MAX_DAYS, required: true });
    }),
  async run(services, args, ctx) {
    const range = resolveInstantRange(args, ctx.now);
    if (!range.ok) return range;
    const { from, to } = range;
    if (from === undefined || to === undefined) throw new Error("F4.291: get_point_stats resolved an open range past its schema");

    /** One service call for asked ids (never `[]`): every asked id in order, a missing one as no data. */
    const read = async (assetIds: readonly string[]) => {
      const answer = parseStoredContract(
        pointStatsByAssetSchema,
        await services.telemetry.pointStatsByAsset({ assetIds, pointKey: args.pointKey, from, to, now: ctx.now }),
        "copilot_tools.get_point_stats.result",
      );
      const byId = new Map(answer.rows.map((row) => [row.assetId, row]));
      const items: PointStatsRow[] = assetIds.map(
        (assetId) => byId.get(assetId) ?? { assetId, min: null, avg: null, max: null, last: null, lastAt: null, sampleCount: 0 },
      );
      const { pointKey, from: askedFrom, to: askedTo, coveredFrom, coveredTo, bucketSeconds } = answer;
      return { items, extra: { pointKey, from: askedFrom, to: askedTo, coveredFrom, coveredTo, bucketSeconds } };
    };

    if (args.assetIds !== undefined) {
      const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
      if (!target.ok) return target;
      const placed = await organizationsOfAssets(services.access, ctx.user, target.ids, args.assetIds);
      if (placed === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
      const asked = [...new Set(args.assetIds)];
      const out = collectByOrganization<PointStatsRow>();
      for (const organizationId of target.ids) {
        const ids = asked.filter((assetId) => placed.get(assetId) === organizationId);
        if (ids.length === 0) continue;
        const page = await read(ids);
        out.add(organizationId, page.items, POINT_STATS_MAX_ASSETS, page.extra);
      }
      return listResult(out, false);
    }

    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema } };
    return readPerOrganization<PointStatsRow, number>(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
      const page = offsetPage(assetIds, resume, Math.min(room, POINT_STATS_MAX_ASSETS));
      if (page.items.length === 0) return { items: [], more: false, keyAt: page.keyAt };
      return { ...page, ...(await read(page.items)) };
    });
  },
});
