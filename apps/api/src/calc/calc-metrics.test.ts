import { describe, it } from "vitest";

import { runCalcMetricsTests } from "./calc-metrics.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc engine metrics wiring", () => {
  it("labels every skip reason distinctly and tracks writes and active formulas", async () => {
    await runCalcMetricsTests();
  });
});
