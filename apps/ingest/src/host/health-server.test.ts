import { describe, it } from "vitest";

import { runDeviceStalenessTests, runHealthRenderTests } from "./health-server.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("health endpoint", () => {
  it("reports per-endpoint state, loss counters and skipped RTUs", () => {
    runHealthRenderTests();
  });

  it("names a silent RTU on a connected endpoint", () => {
    runDeviceStalenessTests();
  });
});
