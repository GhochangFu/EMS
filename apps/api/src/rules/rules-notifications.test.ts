import { describe, it } from "vitest";

import { runRuleNotificationScopeTests } from "./rules-notifications.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.8 rule-notification routes", () => {
  it("refuses a rule outside the caller's asset scope, on both the read and the write", async () => {
    await runRuleNotificationScopeTests();
  });
});
