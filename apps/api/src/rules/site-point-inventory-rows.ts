/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — the pure half of the copilot's
 * `get_site_point_inventory`: the order of the (asset, point) pairs it pages
 * over, the rules already watching each pair, the unit it reports and the
 * shape of one row. `SitePointInventoryService` reads; the tool composes.
 */

/** One asset of the inventory, as the model sees it. */
export type InventoryAsset = { readonly id: string; readonly code: string; readonly name: string; readonly domain: string };

/** One (asset, rule-target point) pair: the unit the inventory pages over. */
export type InventoryPair = { readonly assetId: string; readonly pointKey: string };

/**
 * One pair's 7-day statistics from `telemetry.point_values_1m`. `samples` is
 * 0 and every figure `null` for a pair with no bucket in the window.
 */
export type InventoryStats = {
  readonly unit: string | null;
  readonly min: number | null;
  readonly avg: number | null;
  readonly max: number | null;
  readonly last: number | null;
  readonly samples: number;
};

/** The fields of a rule list row the inventory reads. */
export type WatchingRule = {
  readonly id: string;
  readonly assetId: string | null;
  readonly pointKey: string | null;
  readonly lifecycleStatus: string;
};

/** Owner ruling P6 (2026-10-27): at most this many rule ids per point, beside the full `ruleCount`. */
export const INVENTORY_MAX_RULE_IDS = 10;

/**
 * Every pair, in the order of `assets` and then of each asset's own keys (the
 * rule point set's order: map, template, active `asset_points`). An asset
 * with no key adds no pair. The order is what an offset cursor resumes in.
 */
export function inventoryPairs(assets: readonly InventoryAsset[], keysByAsset: ReadonlyMap<string, readonly string[]>): InventoryPair[] {
  return assets.flatMap((asset) => (keysByAsset.get(asset.id) ?? []).map((pointKey) => ({ assetId: asset.id, pointKey })));
}

export type Watching = { readonly ruleIds: string[]; readonly ruleCount: number };

/**
 * The rules watching each pair. Every rule that is not archived counts —
 * draft, published, enabled or disabled (ruling P6): a draft already on a
 * pair is a rule the model should not propose twice. A rule with no asset or
 * no point (a time-window rule) watches no pair.
 */
export function rulesWatching(rules: readonly WatchingRule[]): { get(assetId: string, pointKey: string): Watching } {
  const byPair = new Map<string, string[]>();
  for (const rule of rules) {
    if (rule.lifecycleStatus === "archived" || rule.assetId === null || rule.pointKey === null) continue;
    const key = pairKey(rule.assetId, rule.pointKey);
    byPair.set(key, [...(byPair.get(key) ?? []), rule.id]);
  }
  return {
    get(assetId, pointKey) {
      const ids = byPair.get(pairKey(assetId, pointKey)) ?? [];
      return { ruleIds: ids.slice(0, INVENTORY_MAX_RULE_IDS), ruleCount: ids.length };
    },
  };
}

/** A NUL cannot occur in a uuid or a point key, so this key is unambiguous. */
function pairKey(assetId: string, pointKey: string): string {
  return `${assetId}\u0000${pointKey}`;
}

/**
 * The unit the model sees: the samples' own unit, else the asset's active
 * mapping's (`asset_points.unit`, what `list_asset_points` shows for the same
 * point), else the fleet catalog's (`point_keys.unit`). An empty string is no
 * unit.
 */
export function inventoryUnit(sampleUnit: string | null, mappingUnit: string | null, catalogUnit: string | null): string | null {
  for (const unit of [sampleUnit, mappingUnit, catalogUnit]) {
    if (unit !== null && unit !== "") return unit;
  }
  return null;
}

/** Six significant digits: a composed mean's long tail costs page room and says nothing a threshold needs. */
export function inventoryStat(value: number | null): number | null {
  return value === null ? null : Number(value.toPrecision(6));
}

/**
 * One page row: the pair, its rounded statistics, and the rules watching it.
 * `asset` is the index of the pair's asset in the page's `assets` (`F4.288`
 * review): a small integer in place of the 36-character id the page already
 * holds once, ~37 characters a row, so a page holds more rows.
 */
export function inventoryRow(pair: InventoryPair, asset: number, stats: InventoryStats, watching: ReturnType<typeof rulesWatching>) {
  return {
    asset,
    key: pair.pointKey,
    unit: stats.unit,
    min: inventoryStat(stats.min),
    avg: inventoryStat(stats.avg),
    max: inventoryStat(stats.max),
    last: inventoryStat(stats.last),
    samples: stats.samples,
    ...watching.get(pair.assetId, pair.pointKey),
  };
}

export type InventoryRow = ReturnType<typeof inventoryRow>;
