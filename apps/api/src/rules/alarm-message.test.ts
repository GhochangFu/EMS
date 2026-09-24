import { describe, it } from "vitest";

import {
  FORMAT_ALARM_VALUE_CASES,
  runAlarmMessageTests,
  testFallbackWithUnit,
  testFallbackWithoutUnit,
  testFormatAlarmValueCase,
} from "./alarm-message.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("alarm-message", () => {
  it("composes alarm text from a rule's markers and condition, not a pointKey guess", () => {
    runAlarmMessageTests();
  });

  it("the generic fallback composes the breach value without a unit", () => {
    testFallbackWithoutUnit();
  });

  it("the generic fallback composes the breach value with its unit", () => {
    testFallbackWithUnit();
  });

  it.each(FORMAT_ALARM_VALUE_CASES)("formatAlarmValue(%s) is %s — %s", (input, expected, claim) => {
    testFormatAlarmValueCase(input, expected, claim);
  });
});
