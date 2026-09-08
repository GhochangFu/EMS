import { describe, it } from "vitest";

import { runEvaluateThrottleRouteTests } from "./evaluate-throttle-route.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.47 evaluate route", () => {
  it("refuses a too-soon press with 429 before the sweep and before the scope read", async () => {
    await runEvaluateThrottleRouteTests();
  });
});
