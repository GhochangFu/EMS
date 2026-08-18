import { describe, it } from "vitest";

import { runAlarmSeveritySummaryTests, runAlarmSeverityToneTests } from "./alarm-severity.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("alarm-severity", () => {
  it("does not colour an unrecognised severity as the least urgent", () => {
    runAlarmSeverityToneTests();
  });

  it("counts every alarm into exactly one bucket, unknowns included", () => {
    runAlarmSeveritySummaryTests();
  });
});
