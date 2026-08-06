import { describe, it } from "vitest";

import { runRulePointsTests } from "./rule-points.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rule-points", () => {
  it("resolves the telemetry points a rule may reference for an asset", () => {
    runRulePointsTests();
  });
});
