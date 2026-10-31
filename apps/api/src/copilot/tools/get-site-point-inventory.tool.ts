import { rulesResponseSchema } from "@bms/shared";
import { z } from "zod";

import { parseStoredContract } from "../../common/parse-stored-contract";
import { BACKTEST_WINDOW_MS } from "../../rules/rule-backtest";
import {
  inventoryRow,
  rulesWatching,
  type InventoryAsset,
  type InventoryPair,
  type InventoryRow,
  type InventoryStats,
} from "../../rules/site-point-inventory-rows";
import { scrubToolResult } from "../copilot-secret-scrub";
import type { CopilotToolContext, CopilotToolResult } from "../copilot-read-tools";
import { CURSOR_PHRASE, LOCATION_ID_PHRASE, listCursorSchema, offsetKeySchema, offsetPage } from "./copilot-list-paging";
import { COPILOT_TOOL_RESULT_BUDGET_CHARS, type CopilotReadServices, defineReadTool, readPerOrganization } from "./copilot-read-tool";

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

/**
 * `F4.296` (ADR 0099 Amendment 10 F2) — the most unwatched points one
 * `unruled` page reads. A point there is a key and a unit (about 20
 * characters, against ~188 for a full row), so the result budget ends a page
 * long before this does ({@link unruledPagePoints}).
 */
export const INVENTORY_UNRULED_PAGE_MAX_POINTS = 400;

/** `F4.296` — one asset of an `unruled` page: its unwatched points as key → unit (`null`: no unit). */
export type UnruledAsset = { readonly assetId: string; readonly code: string; readonly points: Record<string, string | null> };

/**
 * `F4.296` (owner ruling 2026-10-31, Amendment 10 F2 as amended) — one item
 * of an `unruled` page: a set of unwatched points (key → unit) once, with the
 * codes of the page's assets that have exactly that set. No asset ids: the
 * full inventory stays the read before a rule card.
 */
export type UnruledGroup = { readonly codes: readonly string[]; readonly points: Record<string, string | null> };

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
 *
 * `F4.296` (ADR 0099 Amendment 10 F2): `unruled: true` answers "which
 * points have no rule" in a dense shape — see {@link readUnruled}.
 */
export const getSitePointInventoryTool = defineReadTool({
  name: "get_site_point_inventory",
  description:
    `Every rule-target point of every asset at ${LOCATION_ID_PHRASE}, optional domain: unit, 7-day min/avg/max/last, ` +
    `samples, and ruleIds (at most 10) and ruleCount of the rules already watching it; a row's asset is its index in assets. Read it before proposing rules for a site; ${CURSOR_PHRASE}. ` +
    "unruled: true lists only the points no rule watches, with the counts: each distinct set of points (key and unit) once, with the codes of the assets that have it.",
  schema: z
    .object({
      locationId: z.string().uuid(),
      domain: z.string().min(1).max(32).optional(),
      cursor: listCursorSchema.optional(),
      unruled: z.boolean().optional(),
    })
    .strict(),
  async run(services, args, ctx) {
    if (args.unruled === true) return readUnruled(services, ctx, args);
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
 * `F4.296` (ADR 0099 Amendment 10 F2) — `unruled`: the subtree placed as
 * the full inventory's is, its rule point set (`pairs`), and the rules of
 * **every** subtree asset read once, so a pair is unwatched by the same
 * `rulesWatching` the full rows count with (an archived rule watches
 * nothing). The entry's counts — `assetCount`, `pointCount`,
 * `watchedCount`, `unwatchedCount` — are the whole subtree's on every
 * page. The items are one per distinct set of unwatched points
 * ({@link unruledGroups}): the set as key → unit once, with the codes of the
 * assets that have it; no statistics, no rule ids, no asset ids. The live
 * check (78 assets, 330 unwatched points) needed two pages of one entry per
 * asset, and the model read the first page again instead of sending the
 * cursor; grouped, the same site is one page. The unit is the mapping's or
 * the catalog's (`units`, for the page's pairs only; no `telemetry.*` read,
 * so a large page costs no 7-day statement).
 *
 * The cursor's key is an offset into the unwatched pairs. A page is the
 * longest prefix of them whose grouped JSON fits the budget
 * ({@link unruledPagePoints}); `keyAt` maps the groups `fitListResult` keeps
 * back to that offset ({@link unruledKeyAt}).
 */
async function readUnruled(
  services: CopilotReadServices,
  ctx: CopilotToolContext,
  args: { locationId: string; domain?: string; cursor?: string },
): Promise<CopilotToolResult> {
  const scope = { locationId: args.locationId, paging: { cursor: args.cursor, key: offsetKeySchema }, maxItems: INVENTORY_UNRULED_PAGE_MAX_POINTS };
  return readPerOrganization<UnruledGroup, number>(services, ctx, scope, async (_organizationId, assetIds, room, resume) => {
    const { assets, pairs } = await services.inventory.pairs(assetIds, args.domain);
    const rules =
      assets.length === 0
        ? []
        : parseStoredContract(rulesResponseSchema, await services.rules.listRules(assets.map((asset) => asset.id)), "copilot_tools.get_site_point_inventory.unruled_rules").items;
    const watching = rulesWatching(rules);
    const unwatched = pairs.filter((pair) => watching.get(pair.assetId, pair.pointKey).ruleCount === 0);
    const head = { assetCount: assets.length, pointCount: pairs.length, watchedCount: pairs.length - unwatched.length, unwatchedCount: unwatched.length };
    const offered = offsetPage(unwatched, resume, room);
    if (offered.items.length === 0) return { ...offered, items: [], extra: head };
    const units = await services.inventory.units(offered.items);
    const codeOf = new Map(assets.map((asset) => [asset.id, asset.code]));
    const groupsOf = (n: number) => unruledGroups(unruledAssets(offered.items.slice(0, n), units, codeOf));
    const kept = unruledPagePoints(head, groupsOf, offered.items.length);
    const pageAssets = unruledAssets(offered.items.slice(0, kept), units, codeOf);
    const items = unruledGroups(pageAssets);
    return { ...offsetPage(unwatched, resume, kept), keyAt: unruledKeyAt(resume ?? 0, pageAssets, items), items, extra: head };
  });
}

/**
 * The page's assets merged by their set of unwatched points, in the order each
 * set first appears. Two sets are one when they hold the same keys with the
 * same units in the same order (the rule point set's order, so one template's
 * assets match).
 */
export function unruledGroups(assets: readonly UnruledAsset[]): UnruledGroup[] {
  const bySet = new Map<string, { codes: string[]; points: Record<string, string | null> }>();
  for (const asset of assets) {
    const set = JSON.stringify(Object.entries(asset.points));
    const group = bySet.get(set);
    if (group === undefined) bySet.set(set, { codes: [asset.code], points: asset.points });
    else group.codes.push(asset.code);
  }
  return [...bySet.values()];
}

/** The pairs grouped by asset, in their order, each point's unit from `units` (same index). */
export function unruledAssets(pairs: readonly InventoryPair[], units: ReadonlyArray<string | null>, codeOf: ReadonlyMap<string, string>): UnruledAsset[] {
  const out: Array<{ assetId: string; code: string; points: Record<string, string | null> }> = [];
  pairs.forEach((pair, i) => {
    let last = out[out.length - 1];
    if (last === undefined || last.assetId !== pair.assetId) {
      last = { assetId: pair.assetId, code: codeOf.get(pair.assetId) ?? pair.assetId, points: {} };
      out.push(last);
    }
    last.points[pair.pointKey] = units[i] ?? null;
  });
  return out;
}

/**
 * `F4.296` — the offset into the unwatched pairs after a page that starts at
 * `start` keeps its first `keptGroups` groups: the points of the page's assets,
 * in pair order, up to the first asset no kept group names. A page kept whole
 * resumes after its last point, and an asset split across two pages resumes at
 * its first point not shown. A shortened page (only when the scrub lengthens a
 * value past the budget) may show a later asset again on the next page, never
 * skip one.
 */
export function unruledKeyAt(start: number, assets: readonly UnruledAsset[], groups: readonly UnruledGroup[]): (keptGroups: number) => number {
  return (keptGroups) => {
    const shown = new Set(groups.slice(0, keptGroups).flatMap((group) => group.codes));
    let offset = start;
    for (const asset of assets) {
      if (!shown.has(asset.code)) break;
      offset += Object.keys(asset.points).length;
    }
    return offset;
  };
}

/**
 * `F4.296` — how many of a page's `offered` unwatched pairs (at least one)
 * fit the result budget, grouped (`groupsOf`) beside `head`, measured after
 * the scrub as {@link inventoryPageRows} measures.
 */
export function unruledPagePoints(head: Record<string, unknown>, groupsOf: (n: number) => UnruledGroup[], offered: number): number {
  const fits = (n: number) =>
    JSON.stringify(scrubToolResult({ ...head, items: groupsOf(n) })).length <= COPILOT_TOOL_RESULT_BUDGET_CHARS - INVENTORY_PAGE_ENVELOPE_CHARS;
  let n = offered;
  while (n > 1 && !fits(n)) n -= 1;
  return n;
}

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
