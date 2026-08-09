import { describe, it } from "vitest";

import { runAuditLimitsTests } from "./audit.limits.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("audit limits", () => {
  it("refuses an over-cap export rather than truncating it", () => {
    runAuditLimitsTests();
  });
});
