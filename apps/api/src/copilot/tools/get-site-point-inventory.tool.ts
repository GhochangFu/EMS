import { rulesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { BACKTEST_WINDOW_MS } from "../../rules/rule-backtest";
import { inventoryRow, rulesWatching, type InventoryAsset, type InventoryRow, type InventoryStats } from "../../rules/site-point-inventory-rows";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolResult } from "../copilot-read-tools";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { COPILOT_TOOL_RESULT_BUDGET_CHARS, defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * The most pairs one page reads. Above the 25 of the other lists, so the
 * result budget, not the item count, ends a page of narrow rows: a row is
 * ~188 characters with one rule, so a page holds ~34-35 points
 * (`site-inventory-read-tools.spec.ts`) and {@link inventoryPageRows} sizes
 * a page of wider rows.
 */
export const INVENTORY_PAGE_MAX_POINTS = 40;

/**
 * `F4.288` review — the characters a page leaves for what wraps its entry:
 * `truncated`, `nextCursor` (an offset cursor encodes to under 80),
 * `organizations` and `organizationId`; ~180 counted, so 250.
 */
export const INVENTORY_PAGE_ENVELOPE_CHARS = 250;

const NO_STATS: InventoryStats = { unit: null, min: null, avg: null, max: null, last: null, samples: 0 };

/**
 * `get_site_point_inventory` (`F4.288`, ADR 0099 Amendment 9 E2) — every
 * rule-target point of every readable asset at a location and its
 * descendants, with its unit, 7-day min / avg / max / last and sample count,
 * and the rules already watching it; so "go through the points of the PHE
 * sites" is one to a few calls, not `list_assets` plus one
 * `list_asset_points` per asset.
 *
 * **Placement before data.** `readPerOrganization` passes `locationId` to
 * `LocationAssetScopeService` (`F4.291`, owner ruling P5): a location outside
 * the turn's organizations is `not_found`, one inside them whose subtree the
 * caller does not read is `outside_grant`, and both are refused before any
 * inventory read (`telemetry.*` has no Row Level Security, so the placement
 * is the containment). The inventory then reads only the helper's ids.
 *
 * **Paging.** The cursor is the `F4.291` opaque cursor; its key is an offset
 * into the subtree's (asset, point) pairs, ordered by asset code, then the
 * rule point set's order (`SitePointInventoryService.pairs`). Statistics and
 * rules are read for the page's pairs only. The rows are flat (one per
 * point, `asset` on each: the index of its asset in the entry's `assets`,
 * which holds each asset's id, code, name and domain once). The page is
 * sized with its assets before it returns ({@link inventoryPageRows}), so a
 * page of long asset names holds fewer rows rather than none (`F4.288`
 * review: a page's assets, unsized, crowded every row out and the page
 * repeated the incoming cursor). `fitListResult` still measures the result
 * and may drop trailing rows (the scrub can lengthen a value); the entry's
 * `assets` are then cut to the ones its rows still name, a prefix, so no
 * index moves. The window is the backtest's fixed 7 days on the turn's clock
 * (E2 names no other; ruling P3's `lastDays` is for the range tools).
 */
export const getSitePointInventoryTool = defineReadTool({
  name: "get_site_point_inventory",
  description:
    `Every rule-target point of every asset at ${LOCATION_ID_PHRASE}, optional domain: unit, 7-day min/avg/max/last, ` +
    `samples, and ruleIds (at most 10) and ruleCount of the rules already watching it; a row's asset is its index in assets. Read it before proposing rules for a site; ${CURSOR_PHRASE}.`,
  schema: z
    .object({
      locationId: z.string().uuid(),
      domain: z.string().min(1).max(32).optional(),
      cursor: listCursorSchema.optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    const window = { from: new Date(ctx.now.getTime() - BACKTEST_WINDOW_MS).toISOString(), to: ctx.now.toISOString() };
    const scope = { locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema }, maxItems: INVENTORY_PAGE_MAX_POINTS };
    return withPageAssets(
      await readPerOrganization<InventoryRow, number>(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
        const { assets, pairs } = await services.inventory.pairs(assetIds, args.domain);
        const offered = offsetPage(pairs, resume, room);
        const head = { ...window, assetCount: assets.length, pointCount: pairs.length };
        if (offered.items.length === 0) return { ...offered, items: [], extra: { ...head, assets: [] } };
        const pageAssetIds = [...new Set(offered.items.map((pair) => pair.assetId))];
        const [stats, rules] = await Promise.all([services.inventory.stats(offered.items, ctx.now), services.rules.listRules(pageAssetIds)]);
        const watching = rulesWatching(parseStoredContract(rulesResponseSchema, rules, "copilot_tools.get_site_point_inventory.rules").items);
        // The pairs follow `assets`' order, so this keeps first-appearance order and a row's index is its asset's.
        const pageAssets = assets.filter((asset) => pageAssetIds.includes(asset.id));
        const rows = offered.items.map((pair, i) =>
          inventoryRow(pair, pageAssets.findIndex((asset) => asset.id === pair.assetId), stats[i] ?? NO_STATS, watching),
        );
        const kept = inventoryPageRows(head, pageAssets, rows);
        const items = rows.slice(0, kept);
        return { ...offsetPage(pairs, resume, kept), items, extra: { ...head, assets: assetsNamed(pageAssets, items) } };
      }),
    );
  },
});

/**
 * `F4.288` review — how many of `rows` (at least one) fit the result
 * budget beside their own assets and `head`, measured after the scrub as
 * `fitListResult` measures. One row and its asset always fit: every field is
 * a bounded column (a 128-character key, a 255-character name, ten rule ids).
 */
export function inventoryPageRows(head: Record<string, unknown>, assets: readonly InventoryAsset[], rows: readonly InventoryRow[]): number {
  const fits = (n: number) => {
    const items = rows.slice(0, n);
    const entry = { ...head, assets: assetsNamed(assets, items), items };
    return JSON.stringify(scrubToolResult(entry)).length <= COPILOT_TOOL_RESULT_BUDGET_CHARS - INVENTORY_PAGE_ENVELOPE_CHARS;
  };
  let n = rows.length;
  while (n > 1 && !fits(n)) n -= 1;
  return n;
}

/** The prefix of a page's `assets` its rows name: rows are in asset order, so the last row's index ends it. */
function assetsNamed<A>(assets: readonly A[], rows: ReadonlyArray<{ readonly asset: number }>): A[] {
  const last = rows[rows.length - 1];
  return last === undefined ? [] : assets.slice(0, last.asset + 1);
}

/**
 * Each entry's `assets` cut to the assets its rows still name, after
 * `fitListResult` dropped trailing rows. The cut is a prefix, so no row's
 * index moves, and removing entries only shortens the JSON the fit measured,
 * so the result stays within the budget.
 */
function withPageAssets(out: CopilotToolResult): CopilotToolResult {
  if (!out.ok) return out;
  const result = out.result as { organizations: Array<{ items: Array<{ asset: number }>; assets?: unknown[] }> };
  for (const entry of result.organizations) {
    if (entry.assets !== undefined) entry.assets = assetsNamed(entry.assets, entry.items);
  }
  return out;
}
