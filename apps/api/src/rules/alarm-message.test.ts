import { describe, it } from "vitest";

import { runAlarmMessageTests } from "./alarm-message.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-message", () => {
  it("composes alarm text from a rule's markers and condition, not a pointKey guess", () => {
    runAlarmMessageTests();
  });
});
