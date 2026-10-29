import { expect } from "vitest";

import {
  INVENTORY_MAX_RULE_IDS,
  inventoryPairs,
  inventoryRow,
  inventoryStat,
  inventoryUnit,
  rulesWatching,
  type InventoryAsset,
  type WatchingRule,
} from "./site-point-inventory-rows";

/**
 * `F4.288` (ADR 0099 Amendment 9 E2) — the pure half of the site point
 * inventory: the (asset, point) pair order the cursor pages over, the rules
 * already watching a pair (owner ruling P6: every non-archived rule counts,
 * ids cut at 10 beside the full count), the unit precedence (the plan
 * critic's defect 9: samples, then the asset's active mapping, then the
 * fleet catalog) and the statistics' rounding. One `it()` per claim in the
 * sibling `.test.ts` (ADR 0014).
 */

const A = "30000000-0000-4000-8000-00000000000a";
const B = "30000000-0000-4000-8000-00000000000b";
const C = "30000000-0000-4000-8000-00000000000c";

const asset = (id: string, code: string): InventoryAsset => ({ id, code, name: `Gateway ${code}`, domain: "environment" });

const rule = (i: number, assetId: string | null, pointKey: string | null, lifecycleStatus = "published"): WatchingRule => ({
  id: `50000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  assetId,
  pointKey,
  lifecycleStatus,
});

/** Pairs follow the asset order given, then each asset's own key order; an asset with no key adds nothing. */
export function assertPairsFollowTheAssetOrderThenTheKeyOrder(): void {
  // The map is built in a different order than the assets, so a walk over the map reddens.
  const keys = new Map<string, readonly string[]>([
    [C, ["c1"]],
    [B, []],
    [A, ["a2", "a1"]],
  ]);
  const pairs = inventoryPairs([asset(A, "GW-01"), asset(B, "GW-02"), asset(C, "GW-03")], keys);
  expect(pairs).toEqual([
    { assetId: A, pointKey: "a2" },
    { assetId: A, pointKey: "a1" },
    { assetId: C, pointKey: "c1" },
  ]);
}

/** A draft, enabled or disabled rule watches its pair; an archived one does not (ruling P6). */
export function assertAnArchivedRuleDoesNotWatch(): void {
  const watching = rulesWatching([rule(1, A, "k", "draft"), rule(2, A, "k", "archived"), rule(3, A, "k", "published")]);
  expect(watching.get(A, "k")).toEqual({ ruleIds: [rule(1, A, "k").id, rule(3, A, "k").id], ruleCount: 2 });
}

/** The ids are cut at {@link INVENTORY_MAX_RULE_IDS}; `ruleCount` keeps the full count. */
export function assertRuleIdsAreCutAtTenWithTheFullCount(): void {
  const many = Array.from({ length: 13 }, (_, i) => rule(i, A, "k"));
  const answer = watching(many);
  expect([answer.ruleIds, answer.ruleCount]).toEqual([many.slice(0, 10).map((r) => r.id), 13]);
  expect(INVENTORY_MAX_RULE_IDS).toBe(10);
}

function watching(rules: readonly WatchingRule[]) {
  return rulesWatching(rules).get(A, "k");
}

/** A rule on another asset, another key, or with no asset or key (a time-window rule) watches nothing here. */
export function assertARuleWatchesOnlyItsOwnPair(): void {
  const index = rulesWatching([rule(1, B, "k"), rule(2, A, "other"), rule(3, null, null), rule(4, A, null)]);
  expect([index.get(A, "k"), index.get(B, "k").ruleCount, index.get(A, "other").ruleCount]).toEqual([{ ruleIds: [], ruleCount: 0 }, 1, 1]);
}

/** The samples' unit first, then the asset's active mapping, then the catalog; an empty unit is no unit. */
export function assertTheUnitPrecedence(): void {
  expect([
    inventoryUnit("kW", "W", "MW"),
    inventoryUnit(null, "%", "pct"),
    inventoryUnit(null, null, "°C"),
    inventoryUnit("", "", null),
  ]).toEqual(["kW", "%", "°C", null]);
}

/** A statistic keeps six significant digits; null stays null. */
export function assertAStatisticIsRounded(): void {
  expect([inventoryStat(26.666666666666668), inventoryStat(-123_456.78901), inventoryStat(0.000123456789), inventoryStat(null)]).toEqual([
    26.6667,
    -123_457,
    0.000123457,
    null,
  ]);
}

/** A row carries the pair's own statistics and watching rules, under the model-facing names. */
export function assertARowJoinsItsPairStatsAndRules(): void {
  const index = rulesWatching([rule(1, A, "k")]);
  const row = inventoryRow(
    { assetId: A, pointKey: "k" },
    { unit: "%", min: 10, avg: 26.666666666666668, max: 50, last: 20, samples: 6 },
    index,
  );
  expect(row).toEqual({ assetId: A, key: "k", unit: "%", min: 10, avg: 26.6667, max: 50, last: 20, samples: 6, ruleIds: [rule(1, A, "k").id], ruleCount: 1 });
}
