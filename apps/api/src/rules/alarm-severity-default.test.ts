import { describe, it } from "vitest";

import { runAlarmSeverityDefaultingTests } from "./alarm-severity-default.spec";

/** Vitest entry point — see ADR 0014 for the spec/test split. */
describe("alarm-severity-default", () => {
  it("defaults only a missing severity, and never rewrites a live one", () => {
    runAlarmSeverityDefaultingTests();
  });
});
