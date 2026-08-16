import { describe, it } from "vitest";

import { runReportsControllerHeaderTests } from "./reports.controller.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("reports controller", () => {
  it("marks the energy CSV export no-store, matching the audit export (F4.30)", () => {
    runReportsControllerHeaderTests();
  });
});
