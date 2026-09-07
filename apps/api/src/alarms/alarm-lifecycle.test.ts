import { describe, it } from "vitest";

import { runAlarmLifecycleTests } from "./alarm-lifecycle.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-lifecycle", () => {
  it("decides the clear from the hold, the due steps from raised_at, and builds both event inputs from the alarm's own severity", () => {
    runAlarmLifecycleTests();
  });
});
