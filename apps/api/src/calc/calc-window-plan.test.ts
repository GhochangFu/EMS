import { describe, it } from "vitest";

import {
  runAvgOverSparseRowsAnswersTests,
  runBucketBudgetTests,
  runCombineSegmentsTests,
  runCoveredHours1dTests,
  runCoveredHours1hTests,
  runCoveredHoursClipBothEndsTests,
  runCoveredHoursClipHeadOnlyTests,
  runCoveredHoursSingleUnitEmptyTests,
  runCoveredHoursSingleUnitTests,
  runEmptyBeatsSparseTests,
  runMaxOverSparseRowsAnswersTests,
  runMinOverSparseRowsAnswersTests,
  runMinWindowCoverageIsNinetyPercentTests,
  runNaNCoverageRefusesTests,
  runSharedHourCoveredByTheHeadPartTests,
  runSharedHourCoveredByTheTailPartTests,
  runSharedHourTraceSumAnswersTests,
  runSharedHourUncoveredInBothPartsTests,
  runSingleSegmentKeepsItsWindowClipTests,
  runSumAtExactlyTheThresholdAnswersTests,
  runSumJustBelowTheThresholdRefusesTests,
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

describe("calc window plan — the covered-time fold and the window_sparse guard (ADR 0070 Amendment 3, E4.4)", () => {
  it("C1 a 1d segment counts 24 h per covered day; the clips are zero on an aligned segment", () => {
    runCoveredHours1dTests();
  });
  it("C2 a 1h segment counts 1 h per covered hour", () => {
    runCoveredHours1hTests();
  });
  it("C3 a 5m segment clips both covered hours to the segment (23/60 h)", () => {
    runCoveredHoursClipBothEndsTests();
  });
  it("C4 a 1m segment with an uncovered head hour subtracts no head clip (1 h)", () => {
    runCoveredHoursClipHeadOnlyTests();
  });
  it("C5 a covered segment inside one hour counts its own length (0.05 h)", () => {
    runCoveredHoursSingleUnitTests();
  });
  it("C5b an uncovered segment inside one hour counts 0 h", () => {
    runCoveredHoursSingleUnitEmptyTests();
  });
  it("F1a a clock hour split between a 5m and a 1m segment, covered only in its 5m part, counts in full (92 min)", () => {
    runSharedHourCoveredByTheHeadPartTests();
  });
  it("F1a2 the shared-hour trace's sum answers rather than window_sparse", () => {
    runSharedHourTraceSumAnswersTests();
  });
  it("F1b the mirror: covered only in its 1m part, the shared hour counts in full (92 min)", () => {
    runSharedHourCoveredByTheTailPartTests();
  });
  it("F1c a shared hour with no sample in either part counts 0 h", () => {
    runSharedHourUncoveredInBothPartsTests();
  });
  it("F1d a single segment keeps its clip to the window (45 min)", () => {
    runSingleSegmentKeepsItsWindowClipTests();
  });
  it("G1 a sum at exactly 90% coverage (648/720) answers", () => {
    runSumAtExactlyTheThresholdAnswersTests();
  });
  it("G2 a sum just below 90% coverage (647/720) refuses window_sparse", () => {
    runSumJustBelowTheThresholdRefusesTests();
  });
  it("G3 a NaN coverage fraction refuses window_sparse (fail closed)", () => {
    runNaNCoverageRefusesTests();
  });
  it("G4 an empty sum window is window_empty, never window_sparse", () => {
    runEmptyBeatsSparseTests();
  });
  it("G5 avg over sparse rows answers", () => {
    runAvgOverSparseRowsAnswersTests();
  });
  it("G6 min over sparse rows answers", () => {
    runMinOverSparseRowsAnswersTests();
  });
  it("G7 max over sparse rows answers", () => {
    runMaxOverSparseRowsAnswersTests();
  });
  it("G8 MIN_WINDOW_COVERAGE is 0.9", () => {
    runMinWindowCoverageIsNinetyPercentTests();
  });
});
