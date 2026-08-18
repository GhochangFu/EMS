import { describe, it } from "vitest";

import { runAlarmSeverityDefaultingTests } from "./alarm-threshold.service.spec";

/** Vitest entry point — see ADR 0014 for the spec/test split. */
describe("alarm-threshold.service", () => {
  it("defaults only a missing severity, and never rewrites a live one", () => {
    runAlarmSeverityDefaultingTests();
  });
});
