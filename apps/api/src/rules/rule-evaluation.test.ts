import { describe, it } from "vitest";

import { runRuleEvaluationTests } from "./rule-evaluation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rule-evaluation", () => {
  it("decides threshold and time-window rules without a database or a clock", async () => {
    await runRuleEvaluationTests();
  });
});
