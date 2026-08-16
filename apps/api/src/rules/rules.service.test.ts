import { describe, it } from "vitest";

import { runRuleSeverityRoundTripTests } from "./rules.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("rules.service", () => {
  it("stores the severity it was given, including none at all", async () => {
    await runRuleSeverityRoundTripTests();
  });
});
