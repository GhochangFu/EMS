import { describe, it } from "vitest";

import { runHealthAndLoggerTests } from "./health-server.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("health endpoint and host logger", () => {
  it("reports per-endpoint state, loss counters and skipped RTUs", () => {
    runHealthAndLoggerTests();
  });
});
