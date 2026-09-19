import { describe, it } from "vitest";

import {
  runEvaluateTests,
  runEvaluateV2Tests,
  runEvaluateV3Tests,
  runEvaluateWindowAbsentTests,
  runEvaluateWindowNamespaceTests,
  runEvaluateWindowServedTests,
  runEvaluateWindowV2AndFiniteTests,
} from "./evaluate.spec";

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

describe("bms-calc-v3 evaluate", () => {
  it("reads $key parameters from the fourth map only, refusing at the $ when one is absent", () => {
    runEvaluateV3Tests();
  });
});

describe("bms-calc-v3 evaluate — windows (E4.1b)", () => {
  it("serves window and hours nodes from the fifth map by windowKey", () => {
    runEvaluateWindowServedTests();
  });
  it("a read absent from the fifth map is missing_input at the node", () => {
    runEvaluateWindowAbsentTests();
  });
  it("the fifth map is its own namespace and defaults to empty", () => {
    runEvaluateWindowNamespaceTests();
  });
  it("a v2 AST never reads the windows map; a non-finite window value refuses at the node", () => {
    runEvaluateWindowV2AndFiniteTests();
  });
});
