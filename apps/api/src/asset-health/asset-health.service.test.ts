import { describe, it } from "vitest";

import {
  assertComputedAtIsNewestRowInstantOrNull,
  assertScoresByLocationOnAnEmptyInputTouchesNothing,
  assertCoverageCountsDistinctBucketsOverTheSamePredicate,
  assertCoveredBucketsIsTheScopeCountNotTheRowCount,
  assertEmptyScopeNeverTouchesTheCounterRelation,
  assertEmptyScopeReportsZeroCoverageAndNoInstant,
  assertEveryAssetInScopeIsScoredEvenWithNoCounterRows,
  assertExpectedBucketsFollowsTheLadderAtEveryRung,
  assertHealthForAssetsAnswersParsedBlockOrUndefined,
  assertMalformedHealthYieldsNullBandNotThrow,
  assertRuleTalliesUseMaxNotSum,
  assertScoresInScopeIsTheSummaryPerAsset,
  assertScoresInScopeOnAnEmptyScopeReadsNoCounter,
  assertUnruledCatalogPointAppearsInUnscoredTags,
} from "./asset-health.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-health.service", () => {
  it("aggregates the rule tallies with max(), not sum()", async () => {
    await assertRuleTalliesUseMaxNotSum();
  });

  it("never touches the counter relation when the scope is empty", async () => {
    await assertEmptyScopeNeverTouchesTheCounterRelation();
  });

  it("scores every asset in scope, even one with no counter rows at all", async () => {
    await assertEveryAssetInScopeIsScoredEvenWithNoCounterRows();
  });

  it("reports an unruled catalog point in unscoredTags rather than dropping it", async () => {
    await assertUnruledCatalogPointAppearsInUnscoredTags();
  });

  it("yields band: null on a malformed stored health block instead of throwing", async () => {
    await assertMalformedHealthYieldsNullBandNotThrow();
  });

  it("reports computedAt as the newest row instant, or null when none were read", async () => {
    await assertComputedAtIsNewestRowInstantOrNull();
  });

  it("derives expectedBuckets from F3.35's ladder at every rung", async () => {
    await assertExpectedBucketsFollowsTheLadderAtEveryRung();
  });

  it("counts distinct buckets over the same predicate the scores came from", async () => {
    await assertCoverageCountsDistinctBucketsOverTheSamePredicate();
  });

  it("reports the scope-wide covered count, not the number of tag rows", async () => {
    await assertCoveredBucketsIsTheScopeCountNotTheRowCount();
  });

  it("reports zero coverage and no instant together on an empty scope", async () => {
    await assertEmptyScopeReportsZeroCoverageAndNoInstant();
  });

  it("F4.364 — scoresByLocation on an empty input answers an empty map and touches nothing", async () => {
    await assertScoresByLocationOnAnEmptyInputTouchesNothing();
  });

  it("E1.8a — scoresInScope gives one entry per in-scope asset, in id order, agreeing with summary", async () => {
    await assertScoresInScopeIsTheSummaryPerAsset();
  });

  it("E1.8a — scoresInScope on an empty scope answers [] without a counter read", async () => {
    await assertScoresInScopeOnAnEmptyScopeReadsNoCounter();
  });

  it("E1.5a — healthForAssets answers a parsed block, or undefined for a template without health", async () => {
    await assertHealthForAssetsAnswersParsedBlockOrUndefined();
  });
});
