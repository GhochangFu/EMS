import { describe, it } from "vitest";

import {
  assertCollapseIsAttributed,
  assertDeviceTimeNeverReachesTime,
  assertNotifyPayloadKeepsFiveFields,
  assertOmittedTimestampYieldsNullDeviceTime,
  assertTheFirstCollapseIsTheOneNamed,
  assertUnreadableTimestampYieldsNullDeviceTimeAndCounts,
  assertUnstorableTimestampYieldsNullDeviceTimeAndCounts,
} from "./normaliser-time.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * **One `it()` per claim, deliberately.** `normaliser.test.ts` runs fifteen
 * blocks inside one `it()`, so a mutation that reddens block 14 is
 * indistinguishable from one that reddens block 1. ADR 0061's claims each get
 * their own case so a mutation can be shown to redden the assertion that owns
 * it.
 */
describe("ADR 0061 — receive time in time, device time beside it", () => {
  it("never lets a device timestamp reach time, and stores it unclamped", () => {
    assertDeviceTimeNeverReachesTime();
  });

  it("writes a null device_time when the payload carried no timestamp", () => {
    assertOmittedTimestampYieldsNullDeviceTime();
  });

  it("writes a null device_time and counts invalidTimestamp when it cannot read one", () => {
    assertUnreadableTimestampYieldsNullDeviceTimeAndCounts();
  });

  it("writes a null device_time and counts invalidTimestamp when it cannot store one", () => {
    assertUnstorableTimestampYieldsNullDeviceTimeAndCounts();
  });

  it("collapses on the stored key and names the point it discarded", () => {
    assertCollapseIsAttributed();
  });

  it("names the first collapse, not the last", () => {
    assertTheFirstCollapseIsTheOneNamed();
  });

  it("keeps the pg_notify payload at exactly five fields", async () => {
    await assertNotifyPayloadKeepsFiveFields();
  });
});
