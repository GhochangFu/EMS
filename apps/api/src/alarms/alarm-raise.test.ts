import { describe, it } from "vitest";

import { runAlarmRaiseTests } from "./alarm-raise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-raise", () => {
  it("raises only a matched threshold rule, never a time-window match, and gates on sample age", () => {
    runAlarmRaiseTests();
  });
});
