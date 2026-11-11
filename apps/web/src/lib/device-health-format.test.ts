import { describe, it } from "vitest";

import { runDropsSummaryEarliestTests, runFirstDroppedLabelTests } from "./device-health-format.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("device-health format (F3.16, ADR 0127 decision 4)", () => {
  it("names the earliest drop across reasons", () => {
    runDropsSummaryEarliestTests();
  });

  it("names the first dropped asset with assetLabelOf (ADR 0111)", () => {
    runFirstDroppedLabelTests();
  });
});
