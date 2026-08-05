import { describe, it } from "vitest";

import { runHealthRenderTests } from "./health-server.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("health endpoint", () => {
  it("reports per-endpoint state, loss counters and skipped RTUs", () => {
    runHealthRenderTests();
  });
});
