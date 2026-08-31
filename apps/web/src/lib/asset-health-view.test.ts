import { describe, it } from "vitest";

import {
  anAbsentCoveragePairSaysNothingRatherThanUndefined,
  bandNullReadsAsUnconfiguredNotNoData,
  computedAtNullSaysNotYetComputedNeverANow,
  coverageBeyondTheExpectedCountReadsAsComplete,
  coverageIsPrintedAsTwoIntegersNeverARatio,
  donutSliceShareIsAgainstTheTotalAssetCount,
  nullScoreAndZeroScoreRenderDifferently,
  partialWindowIsItsOwnStateNotTheEmptyOne,
  scoreIsMultipliedByOneHundredOnlyHere,
  thePartialSentenceDoesNotClaimAScore,
  unscoredTagMessageDistinguishesSkippedFromNeverMatched,
} from "./asset-health-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec.ts` (ADR 0014). */
describe("asset-health-view", () => {
  it("renders a null score and a zero score as different strings", () => {
    nullScoreAndZeroScoreRenderDifferently();
  });

  it("multiplies the 0..1 score by 100 only at this rendering edge", () => {
    scoreIsMultipliedByOneHundredOnlyHere();
  });

  it("reads an unconfigured band as 'Unconfigured', never as 'no data'", () => {
    bandNullReadsAsUnconfiguredNotNoData();
  });

  it("gives a skipped rule a different sentence from a tag no rule ever matched", () => {
    unscoredTagMessageDistinguishesSkippedFromNeverMatched();
  });

  it("shares a donut slice against the total asset count, not the banded sum", () => {
    donutSliceShareIsAgainstTheTotalAssetCount();
  });

  it("says a null computedAt is not yet computed, never a fabricated now", () => {
    computedAtNullSaysNotYetComputedNeverANow();
  });

  it("keeps a partial window a state of its own, never the empty one", () => {
    partialWindowIsItsOwnStateNotTheEmptyOne();
  });

  it("prints coverage as two integers, never as a ratio", () => {
    coverageIsPrintedAsTwoIntegersNeverARatio();
  });

  it("reads coverage past the expected count as complete, not as a warning", () => {
    coverageBeyondTheExpectedCountReadsAsComplete();
  });

  it("says nothing rather than 'undefined' when the API sends no coverage pair", () => {
    anAbsentCoveragePairSaysNothingRatherThanUndefined();
  });

  it("does not claim a score in the partial sentence, which score: null can reach", () => {
    thePartialSentenceDoesNotClaimAScore();
  });
});
