import { describe, it } from "vitest";

import {
  aLiveInputWithoutAPriorHasNoDelta,
  aMatchedRuleNameOutranksTheDelta,
  anUnresolvedCodeIsLeftOutOfTheRefs,
  aStaleInputsPriorStaysOutOfTheBaseline,
  aTenPercentLowerPriorSumIsAnElevenPercentRise,
  avgOfDividesByTheUsableCount,
  minOfIsTheSmallestUsableValue,
  noIdsMeansNoRefs,
  noRuleAndNoDeltaKeepTheFixedLine,
  nothingLiveHasNoDelta,
  priorOfReadsTheEncodedRef,
  sumOfDropsNullAndNaNButKeepsZero,
  sumOfNothingUsableIsNull,
  theDeltaReplacesTheFixedLine,
  theWorstBackupComparesMinAgainstMin,
} from "./control-room-tiles.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.28 /cr-overview tile arithmetic", () => {
  it("drops null and NaN from a sum but keeps zero", () => {
    sumOfDropsNullAndNaNButKeepsZero();
  });

  it("returns null for a sum with nothing usable", () => {
    sumOfNothingUsableIsNull();
  });

  it("divides a mean by the usable count", () => {
    avgOfDividesByTheUsableCount();
  });

  it("takes the smallest usable value as the minimum", () => {
    minOfIsTheSmallestUsableValue();
  });

  it("reads a prior sum 10 % lower as an 11.1 % rise", () => {
    aTenPercentLowerPriorSumIsAnElevenPercentRise();
  });

  it("gives no delta when a live input has no prior", () => {
    aLiveInputWithoutAPriorHasNoDelta();
  });

  it("keeps a stale input's prior out of the baseline", () => {
    aStaleInputsPriorStaysOutOfTheBaseline();
  });

  it("gives no delta when nothing is live", () => {
    nothingLiveHasNoDelta();
  });

  it("compares the worst backup min against min", () => {
    theWorstBackupComparesMinAgainstMin();
  });

  it("puts a matched rule's name before the delta", () => {
    aMatchedRuleNameOutranksTheDelta();
  });

  it("puts the delta before the fixed line", () => {
    theDeltaReplacesTheFixedLine();
  });

  it("keeps the fixed line with no rule and no delta", () => {
    noRuleAndNoDeltaKeepTheFixedLine();
  });

  it("leaves an unresolved code out of the refs", () => {
    anUnresolvedCodeIsLeftOutOfTheRefs();
  });

  it("asks for no refs when no id is resolved", () => {
    noIdsMeansNoRefs();
  });

  it("reads a prior under its encoded ref", () => {
    priorOfReadsTheEncodedRef();
  });
});
