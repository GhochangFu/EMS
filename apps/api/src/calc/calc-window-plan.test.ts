import { describe, it } from "vitest";

import {
  runBucketBudgetTests,
  runCombineSegmentsTests,
  runDeltaOfTests,
  runWindowBoundsTests,
  runWindowPlanEmptyTests,
  runWindowPlanIstDayTests,
  runWindowPlanMonthTests,
  runWindowPlanRollingTests,
  runWindowPlanSastDayTests,
  runWindowPlanStaleWatermarkTests,
  runWindowPlanTilingProperty,
} from "./calc-window-plan.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One
 * `it()` per claim (plan §5). */
describe("calc window plan — segment composition over the continuous aggregates (E4.1b)", () => {
  it("P1 composes an IST day (18:30Z) as 5m, 1h, 5m, 1m", () => {
    runWindowPlanIstDayTests();
  });
  it("P2 drops to 5m when the 1h watermark is behind the start", () => {
    runWindowPlanStaleWatermarkTests();
  });
  it("P3 composes a SAST day (22:00Z) from 1h and tails, never 1d", () => {
    runWindowPlanSastDayTests();
  });
  it("P4 reads a month as 1d to its watermark, then 1h, 5m and 1m to the window end — never clamped to the 1d watermark", () => {
    runWindowPlanMonthTests();
  });
  it("P5 composes a rolling 24h from a 1m head, 5m, 1h, 5m and a 1m tail", () => {
    runWindowPlanRollingTests();
  });
  it("P6 plans nothing for an empty window", () => {
    runWindowPlanEmptyTests();
  });
  it("P7 tiles 2,000 seeded windows exactly: contiguous, aligned, behind each watermark, no adjacent level repeated", () => {
    runWindowPlanTilingProperty();
  });
  it("P8 combines segments: avg is Σsum/Σcount, sum is avg × hours and never Σ sum_value, Σcount 0 is window_empty", () => {
    runCombineSegmentsTests();
  });
  it("P9 reads a delta as last minus first, and one sample or none is window_empty", () => {
    runDeltaOfTests();
  });
  it("P10 floors the window end to the minute and measures hours as elapsed time", () => {
    runWindowBoundsTests();
  });
  it("P11 refuses a 366d read on stalled coarse policies (buckets) and every aggregate read on a blocked refresh (raw minutes); a healthy stack passes both", () => {
    runBucketBudgetTests();
  });
});
