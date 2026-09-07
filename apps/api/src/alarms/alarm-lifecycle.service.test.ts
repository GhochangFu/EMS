import { describe, it } from "vitest";

import { runAlarmLifecycleServiceTests } from "./alarm-lifecycle.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-lifecycle.service", () => {
  it("clears after the hold, broadcasts once, tells the sent channels only, escalates due steps for unacknowledged alarms, and survives one organization failing", async () => {
    await runAlarmLifecycleServiceTests();
  });
});
