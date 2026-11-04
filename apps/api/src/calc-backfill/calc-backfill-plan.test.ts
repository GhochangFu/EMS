import { describe, it } from "vitest";

import {
  anEarlierQuestionRestartsTheCursor,
  asOfInputsKeysLocalReadsByPointKey,
  latestAtOrBeforeIncludesASampleAtTheSameInstant,
  latestAtOrBeforeNeverServesALaterSample,
  latestAtOrBeforeReturnsTheNewestOlderSample,
  noChunkExceedsItsSize,
  parametersAtOmitsAnUncoveredPair,
  theGridIsAlignedWithBucketTimeMs,
  theGridIsHalfOpen,
  theWorstCaseIs267840Buckets,
  theWorstCaseIs536Chunks,
} from "./calc-backfill-plan.spec";

/** `F4.311` PR 5a — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — the backfill plan (pure)", () => {
  it("aligns the grid with bucketTimeMs", theGridIsAlignedWithBucketTimeMs);
  it("starts at the first bucket at or after from and stops before to", theGridIsHalfOpen);
  it("holds 267,840 buckets for 31 days at 10 s", theWorstCaseIs267840Buckets);
  it("splits the worst case into 536 chunks", theWorstCaseIs536Chunks);
  it("never puts more than 500 buckets in a chunk", noChunkExceedsItsSize);
  it("serves the newest sample older than t", latestAtOrBeforeReturnsTheNewestOlderSample);
  it("serves a sample stamped exactly at t", latestAtOrBeforeIncludesASampleAtTheSameInstant);
  it("never serves a sample after t", latestAtOrBeforeNeverServesALaterSample);
  it("restarts the cursor on an earlier question", anEarlierQuestionRestartsTheCursor);
  it("keys local reads by point key", () => asOfInputsKeysLocalReadsByPointKey());
  it("omits a parameter no row covers at t", parametersAtOmitsAnUncoveredPair);
});
