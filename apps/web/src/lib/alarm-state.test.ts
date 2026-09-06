import { describe, it } from "vitest";

import {
  runAlarmLifecycleStateTests,
  runAlarmStateLabelTests,
  runAlarmStateSearchTextTests,
  runCanAcknowledgeTests,
} from "./alarm-state.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-state", () => {
  it("derives all four lifecycle states from the two stamps", () => {
    runAlarmLifecycleStateTests();
  });

  it("labels each state exactly as the operator reads it", () => {
    runAlarmStateLabelTests();
  });

  it("offers acknowledgement on exactly the unacknowledged alarms", () => {
    runCanAcknowledgeTests();
  });

  it("makes a cleared alarm findable by searching for cleared", () => {
    runAlarmStateSearchTextTests();
  });
});
