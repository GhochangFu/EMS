import { describe, it } from "vitest";

import { runCalcBatchTests } from "./calc-batch.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc batch — collapseLatest and filterToInputs", () => {
  it("collapses to the latest sample and filters on (assetId, pointKey), not pointKey alone", () => {
    runCalcBatchTests();
  });
});
