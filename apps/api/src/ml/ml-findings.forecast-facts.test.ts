import { describe, it } from "vitest";

import {
  anAssetOnlyInADroppedLineIsNotListed,
  anOrganizationWithNoPointsSaysSoByTheFilter,
  everyNamedAssetIsListedOnceWithItsLink,
  f1CountsThePointsTheIssueTimeAndTheStaleOnes,
  f2NamesTheColdestAndWarmestPerKey,
  f3LeavesOutAPointWithFewerThanTwelveActualHours,
  f3PicksThePointFurthestFromItsOwnMean,
  f4NamesTheWidestBand,
  f5SaysTheCrossingsEarliestFirst,
  fourPointKeysGiveThreeKeysAndAMoreLine,
  thirteenCandidateLinesKeepEightInTheBudgetsOrder,
  twoOrganizationsNeverMixAndCardsParse,
} from "./ml-findings.forecast-facts.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — the forecast facts (ADR 0135 Amendment 8 decision 2)", () => {
  it("F1: the count, the newest issue time in its site's zone, and the stale count", () =>
    f1CountsThePointsTheIssueTimeAndTheStaleOnes());
  it("F2: coldest/warmest for °C, lowest/highest otherwise; two keys are never compared", () =>
    f2NamesTheColdestAndWarmestPerKey());
  it("F3: the point furthest from its own 24 h mean, signed", () => f3PicksThePointFurthestFromItsOwnMean());
  it("F3: 11 actual hours is out, 12 is in; no point left means no line", () =>
    f3LeavesOutAPointWithFewerThanTwelveActualHours());
  it("F4: the widest p90 − p10 band", () => f4NamesTheWidestBand());
  it("four point keys: three keys and `and 1 more point types.`", () => fourPointKeysGiveThreeKeysAndAMoreLine());
  it("13 candidate lines keep 8, in R-h's order", () => thirteenCandidateLinesKeepEightInTheBudgetsOrder());
  it("F5: expected, beyond and band crossings, earliest first", () => f5SaysTheCrossingsEarliestFirst());
  it("an organization with no forecast point: one line, by the filter (R-r)", () =>
    anOrganizationWithNoPointsSaysSoByTheFilter());
  it("every named asset once with its link; an asset only counted is not listed", () =>
    everyNamedAssetIsListedOnceWithItsLink());
  it("an asset named only in a line the budget dropped is not listed", () => anAssetOnlyInADroppedLineIsNotListed());
  it("cards by organization code; two organizations never mix; every card parses", () =>
    twoOrganizationsNeverMixAndCardsParse());
});
