import { describe, it } from "vitest";

import {
  assertNullIsNone,
  assertTheBoundaryIsLive,
  assertThirtySecondsIsStale,
  assertTwentyTwoSecondsIsLive,
} from "./telemetry-freshness.spec";

/** `F3.68` (plan D9) — `telemetryFreshnessAt`, the shared 25 s judgement. */
describe("F3.68 — telemetryFreshnessAt", () => {
  it("F1 a sample 22 s old is live", () => {
    assertTwentyTwoSecondsIsLive();
  });

  it("F2 a sample 30 s old is stale", () => {
    assertThirtySecondsIsStale();
  });

  it("F3 no sample is none", () => {
    assertNullIsNone();
  });

  it("F4 a sample exactly 25 s old is live (the window is inclusive)", () => {
    assertTheBoundaryIsLive();
  });
});
