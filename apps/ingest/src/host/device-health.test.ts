import { describe, it } from "vitest";

import {
  runAccumulateAndDrainTests,
  runHeartbeatTests,
  runHourSplitTests,
  runLabelCleaningTests,
  runMonitoredRtuIdsTests,
  runPlanTests,
  runRestoreTests,
  runSkewTests,
} from "./device-health.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("device health accumulator (F3.16, ADR 0127 decisions 9, 10, 17)", () => {
  it("sums batches into the hour of their receive time and empties on drain", () => {
    runAccumulateAndDrainTests();
  });

  it("keeps the newest clock skew in whole seconds, clamped to int4", () => {
    runSkewTests();
  });

  it("restores a failed flush, bounded in hours", () => {
    runRestoreTests();
  });

  it("restarts healthy_since only past the host-stale bound, carrying a failed reset", () => {
    runHeartbeatTests();
  });

  it("buckets a batch crossing an hour by each drop's own receive time", () => {
    runHourSplitTests();
  });

  it("stamps monitored_since on plan entry and clears it on exit", () => {
    runPlanTests();
  });

  it("cuts and cleans device-supplied labels", () => {
    runLabelCleaningTests();
  });

  it("monitors every cloud binding and every edge-served RTU", () => {
    runMonitoredRtuIdsTests();
  });
});
