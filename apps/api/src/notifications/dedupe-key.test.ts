import { describe, it } from "vitest";

import {
  runDedupeKeyTests,
  runEventRoundTripTests,
  runNoAlarmRaiseIsARaiseTests,
  runResidualLimitClampedTail,
  runResidualLimitSeveritySuffix,
  runSeverityThatMimicsASuffixIsARaise,
  runTestKindTests,
  runUnknownWhenTheKeyIsAnotherAlarms,
  runUnknownWhenTheKeyIsAnotherRules,
  runUnknownWhenTheRuleIsNull,
} from "./dedupe-key.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 dedupe key", () => {
  it("keeps the raise key, suffixes an escalation step or a clear, and stays within the column", () => {
    runDedupeKeyTests();
  });
});

describe("F3.56 parseDeliveryEvent — the kind read back out of the key", () => {
  it("E1 round-trips every shape buildDedupeKey writes", () => {
    runEventRoundTripTests();
  });

  it("E2 reads a NULL key as a send test", () => {
    runTestKindTests();
  });

  it("E3 reads a no-alarm key as a raise, not a test", () => {
    runNoAlarmRaiseIsARaiseTests();
  });

  it("E4a reads a key with no rule to anchor it as unknown", () => {
    runUnknownWhenTheRuleIsNull();
  });

  it("E4b reads another rule's key as unknown", () => {
    runUnknownWhenTheKeyIsAnotherRules();
  });

  it("E4c reads another alarm's key as unknown", () => {
    runUnknownWhenTheKeyIsAnotherAlarms();
  });

  it("E5 reads a severity that mimics a suffix as a raise", () => {
    runSeverityThatMimicsASuffixIsARaise();
  });

  it("E6a records the severity-suffix residual limit rather than claiming it away", () => {
    runResidualLimitSeveritySuffix();
  });

  it("E6b records the clamped-tail residual limit rather than claiming it away", () => {
    runResidualLimitClampedTail();
  });
});
