import { describe, it } from "vitest";

import {
  aBatchOfTwentyFiveParses,
  aBatchOfTwentySixIsRefused,
  aNonUuidIdIsRefused,
  aPreviewWithoutTheRefusalCountIsRefused,
  aRepeatedIdIsRefused,
  anEchoedPlanIsRefused,
  anEmptyBatchIsRefused,
  theCapIsTheCalcBatchCap,
  aPlanWithoutInheritedDefaultsIsRefused,
  theVocabularyHoldsTheThirteenReasons,
} from "./template-adoption.spec";

/** `F4.312` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — template adoption contracts (ADR 0109 Amendment 1)", () => {
  it("caps a batch at the calc batch's 25", () => theCapIsTheCalcBatchCap());
  it("accepts a batch of 25", () => aBatchOfTwentyFiveParses());
  it("refuses a batch of 26", () => aBatchOfTwentySixIsRefused());
  it("refuses an empty batch", () => anEmptyBatchIsRefused());
  it("refuses a repeated asset id", () => aRepeatedIdIsRefused());
  it("refuses an id that is not a uuid", () => aNonUuidIdIsRefused());
  it("refuses a plan echoed back in the body", () => anEchoedPlanIsRefused());
  it("holds the thirteen refusal reasons", () => theVocabularyHoldsTheThirteenReasons());
  it("requires inheritsDefaults on a per-asset plan", () => aPlanWithoutInheritedDefaultsIsRefused());
  it("requires the true refusal count on a preview", () =>
    aPreviewWithoutTheRefusalCountIsRefused());
});
