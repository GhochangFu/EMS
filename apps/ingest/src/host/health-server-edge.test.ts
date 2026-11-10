import { describe, it } from "vitest";

import { aRecentRefusalDegradesForTenMinutes, anUnsyncedClockDegrades, theCloudHasNoEdgeLine, theEdgeLineRenders } from "./health-server-edge.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge health line (plan T5.5, C12)", () => {
  it("renders the clock and the uplink counters", () => {
    theEdgeLineRenders();
  });

  it("degrades the verdict on clock=unsynced", () => {
    anUnsyncedClockDegrades();
  });

  it("is absent on the cloud host", () => {
    theCloudHasNoEdgeLine();
  });

  it("degrades for ten minutes after a batch is refused for good", () => {
    aRecentRefusalDegradesForTenMinutes();
  });
});
