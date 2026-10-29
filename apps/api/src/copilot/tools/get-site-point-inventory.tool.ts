import { rulesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { BACKTEST_WINDOW_MS } from "../../rules/rule-backtest";
import { inventoryRow, rulesWatching, type InventoryRow, type InventoryStats } from "../../rules/site-point-inventory-rows";
import type { CopilotToolResult } from "../copilot-read-tools";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { defineReadTool, readPerOrganization } from "./copilot-read-tool";

/**
 * The most pairs one page reads. Above the 25 of the other lists, so the
 * result budget, not the item count, ends a page of narrow rows: a row is
 * ~189 characters with no rule and ~227 with one, so a page holds ~29-36
 * points (`site-inventory-read-tools.spec.ts`) and `fitListResult` cuts a
 * page of wider rows.
 */
export const INVENTORY_PAGE_MAX_POINTS = 40;

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
 * point, `assetId` on each) so `fitListResult` can cut a page between two
 * points of one asset and resume at the first it dropped; the page's assets
 * (code, name, domain) ride once in the entry's `assets`, cut after the fit
 * to the assets its rows still name. The window is the backtest's fixed 7
 * days on the turn's clock (E2 names no other; ruling P3's `lastDays` is for
 * the range tools).
 */
export const getSitePointInventoryTool = defineReadTool({
  name: "get_site_point_inventory",
  description:
    `Every rule-target point of every asset at ${LOCATION_ID_PHRASE}, optional domain: unit, 7-day min/avg/max/last, ` +
    `samples, and ruleIds (at most 10) and ruleCount of the rules already watching it. Read it before proposing rules for a site; ${CURSOR_PHRASE}.`,
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
        const page = offsetPage(pairs, resume, room);
        const head = { ...window, assetCount: assets.length, pointCount: pairs.length };
        if (page.items.length === 0) return { ...page, items: [], extra: { ...head, assets: [] } };
        const pageAssetIds = [...new Set(page.items.map((pair) => pair.assetId))];
        const [stats, rules] = await Promise.all([services.inventory.stats(page.items, ctx.now), services.rules.listRules(pageAssetIds)]);
        const watching = rulesWatching(parseStoredContract(rulesResponseSchema, rules, "copilot_tools.get_site_point_inventory.rules").items);
        const items = page.items.map((pair, i) => inventoryRow(pair, stats[i] ?? NO_STATS, watching));
        return { ...page, items, extra: { ...head, assets: assets.filter((asset) => pageAssetIds.includes(asset.id)) } };
      }),
    );
  },
});

/**
 * Each entry's `assets` cut to the assets its rows still name, after
 * `fitListResult` dropped trailing rows. Removing entries only shortens the
 * JSON the fit measured, so the result stays within the budget.
 */
function withPageAssets(out: CopilotToolResult): CopilotToolResult {
  if (!out.ok) return out;
  const result = out.result as { organizations: Array<{ items: Array<{ assetId: string }>; assets?: Array<{ id: string }> }> };
  for (const entry of result.organizations) {
    if (entry.assets === undefined) continue;
    const named = new Set(entry.items.map((row) => row.assetId));
    entry.assets = entry.assets.filter((asset) => named.has(asset.id));
  }
  return out;
}
