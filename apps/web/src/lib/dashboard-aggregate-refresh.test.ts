import { describe, it } from "vitest";

import {
  assertARepeatedRefInOnePayloadIsOneRefetch,
  assertOneRefsRefetchDoesNotSuppressAnother,
  assertTheFirstSampleAlwaysRefetches,
  assertTheFloorIsInclusiveAndHolds,
  assertTheThrottleSitsBetweenItsTwoBounds,
} from "./dashboard-aggregate-refresh.spec";

/** `F3.35` Stage A — Vitest wrapper for the aggregate re-read throttle (ADR 0014). */
describe("F3.35 Stage A — the aggregate re-read throttle", () => {
  it("sits between STALE_TICK_MS and FRESH_MS, read from the constants themselves", () => {
    assertTheThrottleSitsBetweenItsTwoBounds();
  });

  it("re-reads on the first live sample, which has no floor to respect", () => {
    assertTheFirstSampleAlwaysRefetches();
  });

  it("holds the floor on both sides, and treats it as inclusive", () => {
    assertTheFloorIsInclusiveAndHolds();
  });

  it("throttles per ref, so a second payload in the same round is not discarded", () => {
    assertOneRefsRefetchDoesNotSuppressAnother();
  });

  it("collapses a ref repeated within one payload to a single re-read", () => {
    assertARepeatedRefInOnePayloadIsOneRefetch();
  });
});
