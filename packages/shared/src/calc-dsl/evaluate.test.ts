import { describe, it } from "vitest";

import { runEvaluateTests } from "./evaluate.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 evaluator", () => {
  it("evaluates a parsed formula, refusing at the node that produced a non-finite result", () => {
    runEvaluateTests();
  });
});
