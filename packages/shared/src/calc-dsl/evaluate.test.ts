import { describe, it } from "vitest";

import { runEvaluateTests, runEvaluateV2Tests } from "./evaluate.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 evaluator", () => {
  it("evaluates a parsed formula, refusing at the node that produced a non-finite result", () => {
    runEvaluateTests();
  });
});

describe("bms-calc-v2 evaluator", () => {
  it("reads cross-asset references from crossInputs by canonical key and never from inputs", () => {
    runEvaluateV2Tests();
  });
});
