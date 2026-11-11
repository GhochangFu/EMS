import { describe, it } from "vitest";

import {
  runAttributionSumTests,
  runDeviceStringCleaningTests,
  runFanOutAttributionTests,
  runFirstDropPerReasonTests,
  runHourSplitAttributionTests,
  runLastSeenAndSkewTests,
  runUnattributedTests,
} from "./normaliser-attribution.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host normaliser — device attribution (F3.16, ADR 0127 decisions 8 and 9)", () => {
  it("names the first point per reason and keeps naming it", () => {
    runFirstDropPerReasonTests();
  });

  it("names the refused target of a fan-out sample", () => {
    runFanOutAttributionTests();
  });

  it("puts unknown and ambiguous devices in unattributed, never in devices", () => {
    runUnattributedTests();
  });

  it("takes last-seen as the max receive time and skew from the newest device time", () => {
    runLastSeenAndSkewTests();
  });

  it("accounts for every drop: devices plus unattributed equals droppedCount", () => {
    runAttributionSumTests();
  });

  it("splits a reason's tally by the hour of each drop's receive time", () => {
    runHourSplitAttributionTests();
  });

  it("cuts device strings to 128 characters and strips control characters", () => {
    runDeviceStringCleaningTests();
  });
});
