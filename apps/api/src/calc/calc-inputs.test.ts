import { describe, it } from "vitest";

import { runCalcInputsTests } from "./calc-inputs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc inputs — classifyInput and newestTimeMs", () => {
  it("tells missing apart from stale, and picks the newest sample time", () => {
    runCalcInputsTests();
  });
});
