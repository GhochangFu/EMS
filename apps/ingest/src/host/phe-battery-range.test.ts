import { describe, it } from "vitest";

import { runPheBatteryDiagnosisTests, runPheBatteryRangeTests } from "./phe-battery-range.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.354 PHE battery_charge_pct", () => {
  it("stores batt_volt unchanged when the point carries no metadata", () => {
    runPheBatteryDiagnosisTests();
  });

  it("drops −1239.13 % as outOfRange under a 0–100 band and keeps a normal reading", () => {
    runPheBatteryRangeTests();
  });
});
