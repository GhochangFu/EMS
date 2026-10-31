import { describe, it } from "vitest";

import {
  assertAnArchivedRuleDoesNotWatch,
  assertARowJoinsItsPairStatsAndRules,
  assertARuleWatchesOnlyItsOwnPair,
  assertAStatisticIsRounded,
  assertPairsFollowTheAssetOrderThenTheKeyOrder,
  assertRuleIdsAreCutAtTenWithTheFullCount,
  assertTheUnitPrecedence,
} from "./site-point-inventory-rows.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.288 — the site point inventory's pairs and rows", () => {
  it("pairs follow the asset order, then each asset's key order", () => assertPairsFollowTheAssetOrderThenTheKeyOrder());
  it("an archived rule does not watch its pair", () => assertAnArchivedRuleDoesNotWatch());
  it("rule ids are cut at ten beside the full count", () => assertRuleIdsAreCutAtTenWithTheFullCount());
  it("a rule watches only its own pair", () => assertARuleWatchesOnlyItsOwnPair());
  it("the unit is the samples', then the mapping's, then the catalog's", () => assertTheUnitPrecedence());
  it("a statistic keeps six significant digits", () => assertAStatisticIsRounded());
  it("a row joins its pair's statistics and rules", () => assertARowJoinsItsPairStatsAndRules());
});
