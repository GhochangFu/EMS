import { POINT_STATS_MAX_ASSETS, pointStatsByAssetSchema, pointStatsSummarySchema, type PointStatsRow, type PointStatsSummaryRow } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { pointKeySchema } from "../../telemetry/telemetry.schema";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { collectByOrganization, type CopilotReadServices, defineReadTool, listResult, readPerOrganization } from "./copilot-read-tool";
import { COPILOT_RANGE_MAX_DAYS, refineInstantRange, resolveInstantRange, timeRangeFields } from "./copilot-time-range";
import { COPILOT_TOOL_RECORD_OUT_OF_SCOPE, organizationsOfAssets, targetOrganizations } from "./copilot-tool-scope";

export const COPILOT_POINT_STATS_ONE_SOURCE = "give exactly one of locationId or assetIds";
export const COPILOT_POINT_STATS_CURSOR_NEEDS_LOCATION = "cursor pages a locationId read; assetIds is one page";
export const COPILOT_POINT_STATS_SUMMARY_NEEDS_LOCATION = "summary reads a whole locationId: no assetIds and no cursor";

/** `F4.296` (ADR 0099 Amendment 10 F1, drafter choice): the highest and lowest assets a summary names, and the no-data codes. */
export const POINT_STATS_SUMMARY_EXTREMES = 5;
export const POINT_STATS_SUMMARY_NO_DATA_CODES = 10;

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
 * `F4.291` live-check path, `truncated` and `nextCursor` first). The fields
 * every organization shares (`pointKey`, the asked `from`/`to`, the covered
 * period, `bucketSeconds`) are at the top of the result once, never repeated
 * per organization entry: so 25 worst-case rows reach the model whole in one
 * organization (measured 5,523 characters), a location page (5,606), and 25
 * organizations of one asset each (7,155; 9,400 or so with the fields
 * repeated per entry, which the fit cut to 16 rows), under the 7,500 budget
 * (`point-stats-read-tools.spec.ts`).
 * The service is never called with `[]`.
 *
 * `F4.296` (ADR 0099 Amendment 10 F1): `summary: true` with `locationId`
 * (never `assetIds` or `cursor`) answers a whole site in one call — see
 * {@link readSummary}. A location page also carries `assetCount`, the
 * subtree's readable assets, so the turn's partial sentence (F3) can name the
 * total.
 */
export const getPointStatsTool = defineReadTool({
  name: "get_point_stats",
  description:
    "One point key over many assets for lastDays (1-31) or from..to (ISO instants, at most 31 days): min, mean, max, last (newest minute) " +
    `and sample count per asset; no data is null. Give ${LOCATION_ID_PHRASE}, with ${CURSOR_PHRASE}, or assetIds (1-25). Optional organizationId. ` +
    "summary: true with locationId: the whole site in one call (site min/mean/max, the 5 highest and 5 lowest assets by mean, the assets with no data).",
  schema: z
    .object({
      pointKey: pointKeySchema,
      ...timeRangeFields,
      locationId: z.string().uuid().optional(),
      assetIds: z.array(z.string().uuid()).min(1).max(POINT_STATS_MAX_ASSETS).optional(),
      organizationId: z.string().uuid().optional(),
      cursor: listCursorSchema.optional(),
      summary: z.boolean().optional(),
    })
    .strict()
    .superRefine((args, issue) => {
      if (args.summary === true && (args.locationId === undefined || args.cursor !== undefined)) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: COPILOT_POINT_STATS_SUMMARY_NEEDS_LOCATION });
      }
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
      return { items, head: { pointKey, from: askedFrom, to: askedTo, coveredFrom, coveredTo, bucketSeconds } };
    };

    if (args.assetIds !== undefined) {
      const target = targetOrganizations(args.organizationId, ctx.allowedOrganizationIds);
      if (!target.ok) return target;
      const placed = await organizationsOfAssets(services.access, ctx.user, target.ids, args.assetIds);
      if (placed === null) return { ok: false, error: COPILOT_TOOL_RECORD_OUT_OF_SCOPE };
      const asked = [...new Set(args.assetIds)];
      const out = collectByOrganization<PointStatsRow>();
      let head: Record<string, unknown> | undefined;
      for (const organizationId of target.ids) {
        const ids = asked.filter((assetId) => placed.get(assetId) === organizationId);
        if (ids.length === 0) continue;
        const page = await read(ids);
        head = page.head;
        out.add(organizationId, page.items, POINT_STATS_MAX_ASSETS);
      }
      // Measured with the rows: `fitListResult` places `head` once, after the paging key.
      return listResult(out, false, head);
    }

    if (args.summary === true) return readSummary(services, ctx, { ...args, from, to });

    const scope = { organizationId: args.organizationId, locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema } };
    // A location is one organization: its shared fields ride in its entry (so the fit measures them) and are lifted to the top after.
    return liftSharedFields(
      await readPerOrganization<PointStatsRow, number>(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
        const page = offsetPage(assetIds, resume, Math.min(room, POINT_STATS_MAX_ASSETS));
        if (page.items.length === 0) return { items: [], more: false, keyAt: page.keyAt };
        const { items, head } = await read(page.items);
        return { ...page, items, extra: { ...head, assetCount: assetIds.length } };
      }),
    );
  },
});

/**
 * `F4.296` (ADR 0099 Amendment 10 F1) — `summary`: the location placed as
 * every location read is (`readPerOrganization`), then one
 * `pointStatsSummary` over the subtree's readable ids, with no page bound.
 * The entry holds the site row, `assetCount`, `assetsWithNoData`, the
 * {@link POINT_STATS_SUMMARY_EXTREMES} assets with the highest mean and as
 * many with the lowest (never one asset in both), and the codes of at most
 * {@link POINT_STATS_SUMMARY_NO_DATA_CODES} assets with no sample. The codes
 * come from one `listAll` over the named ids only (at most 20). A service row
 * for an id not asked is dropped. The shared fields go to the top, as the
 * location branch's do; the entry has no `items`. The result stays far under
 * the list budget (about 2,000 characters at worst), so it is never paged.
 */
async function readSummary(
  services: CopilotReadServices,
  ctx: CopilotToolContext,
  args: { pointKey: string; locationId?: string; organizationId?: string; from: Date; to: Date },
): Promise<CopilotToolResult> {
  const scope = { organizationId: args.organizationId, locationId: args.locationId };
  const out = await readPerOrganization<never>(services, ctx, scope, async (organizationId, assetIds) => {
    const answer = parseStoredContract(
      pointStatsSummarySchema,
      await services.telemetry.pointStatsSummary({ assetIds, pointKey: args.pointKey, from: args.from, to: args.to, now: ctx.now }),
      "copilot_tools.get_point_stats.summary",
    );
    const asked = new Set(assetIds);
    const rows = answer.rows.filter((row) => asked.has(row.assetId) && row.sampleCount > 0);
    const withData = new Set(rows.map((row) => row.assetId));
    const noData = assetIds.filter((assetId) => !withData.has(assetId));
    const byMean = rows
      .filter((row): row is PointStatsSummaryRow & { avg: number } => row.avg !== null)
      .sort((a, b) => b.avg - a.avg || a.assetId.localeCompare(b.assetId));
    const highest = byMean.slice(0, POINT_STATS_SUMMARY_EXTREMES);
    const lowest = byMean
      .slice(highest.length)
      .reverse()
      .slice(0, POINT_STATS_SUMMARY_EXTREMES);
    const named = [...highest, ...lowest].map((row) => row.assetId).concat(noData.slice(0, POINT_STATS_SUMMARY_NO_DATA_CODES));
    const listed = named.length === 0 ? [] : await services.assets.listAll(named, organizationId);
    const codeOf = new Map(listed.map((asset) => [asset.id, asset.code]));
    const asset = ({ assetId, min, avg, max, sampleCount }: PointStatsSummaryRow) => ({ code: codeOf.get(assetId) ?? null, assetId, min, avg, max, sampleCount });
    const { rows: _rows, site, ...head } = answer;
    return {
      items: [],
      extra: {
        ...head,
        site,
        assetCount: assetIds.length,
        assetsWithNoData: noData.length,
        highest: highest.map(asset),
        lowest: lowest.map(asset),
        noData: noData.slice(0, POINT_STATS_SUMMARY_NO_DATA_CODES).map((assetId) => codeOf.get(assetId) ?? assetId),
      },
    };
  });
  if (!out.ok) return out;
  const { organizations, ...rest } = out.result as { organizations: Array<Record<string, unknown>> } & Record<string, unknown>;
  const top: Record<string, unknown> = {};
  const entries = organizations.map(({ items: _items, pointKey, from, to, coveredFrom, coveredTo, bucketSeconds, ...entry }) => {
    Object.assign(top, { pointKey, from, to, coveredFrom, coveredTo, bucketSeconds });
    return entry;
  });
  return { ...out, result: { ...rest, ...top, organizations: entries } };
}

/**
 * The location branch's result in the `assetIds` branch's shape: the shared
 * fields of the (one) organization entry moved to the top, after the paging
 * keys. Moving a key between two objects of one JSON text adds no character,
 * so the result the fit measured is still within the budget.
 */
function liftSharedFields(out: CopilotToolResult): CopilotToolResult {
  if (!out.ok) return out;
  const { organizations, ...paging } = out.result as { organizations: Array<Record<string, unknown>> } & Record<string, unknown>;
  const head: Record<string, unknown> = {};
  const entries = organizations.map(({ organizationId, items, ...shared }) => {
    Object.assign(head, shared);
    return { organizationId, items };
  });
  return { ...out, result: { ...paging, ...head, organizations: entries } };
}
