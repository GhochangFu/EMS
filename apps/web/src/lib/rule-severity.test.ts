import { describe, it } from "vitest";

import { runNoSeverityOptionTests, runRuleSeverityTests } from "./rule-severity.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("rule-severity", () => {
  it("narrows a stored severity without inventing one", () => {
    runRuleSeverityTests();
  });

  it("offers None where a rule has no severity, not wherever it might want one", () => {
    runNoSeverityOptionTests();
  });
});
