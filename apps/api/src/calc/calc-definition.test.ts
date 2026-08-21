import { describe, it } from "vitest";

import { runCalcDefinitionTests } from "./calc-definition.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc definition loader — toActiveDefinition", () => {
  it("resolves a stored row to a definition, or names why it cannot be used", () => {
    runCalcDefinitionTests();
  });
});
