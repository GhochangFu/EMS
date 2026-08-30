import { describe, it } from "vitest";

import {
  assertAWindowPastTheLastRungThrows,
  assertBothQueriesReuseAvgExpr,
  assertEscalationIsUnreachableAtEveryRung,
  assertGapsAreFilledWithNulls,
  assertMaxBucketsIsDerivedFromTheLadder,
  assertNoQueryCallsSqlAvg,
  assertOnlyTheRelationIsInterpolated,
  assertReadStartCarriesTheCompareReach,
  assertTheBucketGuardIsCheckedPerRung,
  assertTheBucketGuardRefusesPastTheBound,
  assertTheBucketQueryGroupsAndOrders,
  assertTheCompareWindowAbutsTheCurrentOne,
  assertTheFilledCountMatchesTheLadder,
  assertTheLadderPicksAGranularityPerRung,
  assertParameterIndicesAreChecked,
  assertThePeakHasAStableTieBreak,
} from "./point-aggregate-window.spec";

/** `F3.35` Stage A — Vitest wrapper for the pure ADR 0048 read-seam assertions (ADR 0014). */
describe("F3.35 Stage A — the ladder and its bucket bound", () => {
  it("picks a granularity per rung, on both sides of each boundary", () => {
    assertTheLadderPicksAGranularityPerRung();
  });

  it("throws past the coarsest rung rather than defaulting to a level", () => {
    assertAWindowPastTheLastRungThrows();
  });

  it("derives MAX_BUCKETS from the ladder rather than restating it", () => {
    assertMaxBucketsIsDerivedFromTheLadder();
  });

  it("refuses an over-long bucket array rather than truncating the window", () => {
    assertTheBucketGuardRefusesPastTheBound();
  });

  it("checks that bound per rung, so a coarse read cannot sail through the global one", () => {
    assertTheBucketGuardIsCheckedPerRung();
  });

  it("fills a missing bucket with null rather than leaving it absent", () => {
    assertGapsAreFilledWithNulls();
  });

  it("fills to exactly the count the ladder predicts, at every rung", () => {
    assertTheFilledCountMatchesTheLadder();
  });
});

describe("F3.35 Stage A — the window and the compare window", () => {
  it("abuts the compare window to the current one, with no gap and no overlap", () => {
    assertTheCompareWindowAbutsTheCurrentOne();
  });

  it("carries the compare reach in readStart, which is what the retention guard reads", () => {
    assertReadStartCarriesTheCompareReach();
  });

  it("keeps retention escalation unreachable at every rung, compare included", () => {
    assertEscalationIsUnreachableAtEveryRung();
  });
});

describe("F3.35 Stage A — the SQL the endpoint emits", () => {
  it("reuses avgExpr in both queries rather than restating the division", () => {
    assertBothQueriesReuseAvgExpr();
  });

  it("never calls SQL avg(), the form that typechecks and is wrong", () => {
    assertNoQueryCallsSqlAvg();
  });

  it("interpolates only a relation from the closed set, never the function name", () => {
    assertOnlyTheRelationIsInterpolated();
  });

  it("groups and orders the buckets, and fetches one past the bound", () => {
    assertTheBucketQueryGroupsAndOrders();
  });

  it("breaks a tied peak on the earlier bucket, deterministically", () => {
    assertThePeakHasAStableTieBreak();
  });
});

describe("F3.35 Stage A — composing the fragments into one statement", () => {
  it("shifts only the window's parameter indices, and refuses a non-positional one", () => {
    assertParameterIndicesAreChecked();
  });
});
