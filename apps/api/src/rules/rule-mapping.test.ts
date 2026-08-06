import { describe, it } from "vitest";

import { runRuleMappingTests } from "./rule-mapping.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rule-mapping", () => {
  it("narrows stored jsonb and distinguishes an absent field from an explicit null", () => {
    runRuleMappingTests();
  });
});
