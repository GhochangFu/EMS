import { describe, it } from "vitest";

import { runBuildCalcGraphTests, runTemplateCyclesTests, runTopologicalOrderTests } from "./calc-graph.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc graph — buildCalcGraph, topologicalOrder, templateCycles (ADR 0055)", () => {
  it("edges a local ref, a resolved qref and every derived aggregate member, the owner included", () => {
    runBuildCalcGraphTests();
  });
  it("orders deterministically, refuses cycle members only, and keeps every other node in order", () => {
    runTopologicalOrderTests();
  });
  it("reports a template's own cycles over a virtual asset and skips what the save path already refuses", () => {
    runTemplateCyclesTests();
  });
});
