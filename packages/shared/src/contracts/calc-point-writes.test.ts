import { describe, it } from "vitest";

import {
  aBatchOfTwentyFiveParses,
  aBatchOfTwentySixIsRefused,
  aBatchWithANullFormulaIsRefused,
  aBatchWithAnUnknownKeyIsRefused,
  aCompleteSetBodyParses,
  aNullFormulaIsRefused,
  aNullIntervalParses,
  anEmptyBatchIsRefused,
  anIntervalBelowTheMinimumIsRefused,
  anUnknownKeyIsRefused,
  theBatchCapIsTwentyFive,
  thirtyOneBackfillDaysParse,
  thirtyTwoBackfillDaysAreRefused,
} from "./calc-point-writes.spec";

/** `F4.311` PR 2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.311 — standalone calc point bodies (ADR 0109)", () => {
  it("parses a complete set body", () => aCompleteSetBodyParses());
  it("refuses a null formula", () => aNullFormulaIsRefused());
  it("accepts a null interval", () => aNullIntervalParses());
  it("refuses an interval below the minimum", () => anIntervalBelowTheMinimumIsRefused());
  it("accepts 31 backfill days", () => thirtyOneBackfillDaysParse());
  it("refuses 32 backfill days", () => thirtyTwoBackfillDaysAreRefused());
  it("refuses an unknown key", () => anUnknownKeyIsRefused());
  it("caps a batch at 25 assets", () => theBatchCapIsTwentyFive());
  it("accepts a batch of 25", () => aBatchOfTwentyFiveParses());
  it("refuses a batch of 26", () => aBatchOfTwentySixIsRefused());
  it("refuses an empty batch", () => anEmptyBatchIsRefused());
  it("refuses a batch with a null formula", () => aBatchWithANullFormulaIsRefused());
  it("refuses a batch with an unknown key", () => aBatchWithAnUnknownKeyIsRefused());
});
