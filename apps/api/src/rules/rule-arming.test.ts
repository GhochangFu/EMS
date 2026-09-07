import { describe, it } from "vitest";

import { runRuleArmingTests } from "./rule-arming.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rule-arming", () => {
  it("refuses to arm a threshold rule with no operator or threshold (ADR 0058 decision 3)", () => {
    runRuleArmingTests();
  });
});
