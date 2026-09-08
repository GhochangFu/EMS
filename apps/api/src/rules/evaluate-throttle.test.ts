import { describe, it } from "vitest";

import { runEvaluateThrottleTests } from "./evaluate-throttle.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.47 evaluate-now throttle", () => {
  it("holds one 30-second window per organization, and does not re-stamp on a refusal", () => {
    runEvaluateThrottleTests();
  });
});
