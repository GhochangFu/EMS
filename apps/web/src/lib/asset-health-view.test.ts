import { describe, it } from "vitest";

import {
  bandNullReadsAsUnconfiguredNotNoData,
  computedAtNullSaysNotYetComputedNeverANow,
  donutSliceShareIsAgainstTheTotalAssetCount,
  nullScoreAndZeroScoreRenderDifferently,
  scoreIsMultipliedByOneHundredOnlyHere,
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
});
