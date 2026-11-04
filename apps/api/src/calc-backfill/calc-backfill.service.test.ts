import { describe, it } from "vitest";

import {
  aDeletedRunStopsAtTheNextChunk,
  aFinishedWalkMarksTheRunDone,
  aPayloadNamingAnotherPointIsRefused,
  aPointWithNoDefinitionFails,
  aRetryResumesAfterDoneThrough,
  aRunThatIsNotQueuedReturnsNoContinuation,
  aStaleInstantWritesNothing,
  aStoppedWalkDoesNotFinishTheRun,
  aStreamingPointWritesAtItsInputTimes,
  aThrowFailsTheRunByErrorName,
  aThrowIsRethrownWithoutItsMessage,
  everyRowCarriesTheFormulasValue,
  noWriteExceeds500Rows,
  progressLagsTheWrite,
  progressNamesTheChunksLastBucket,
  theWindowIsRefreshedOnceFromTo,
} from "./calc-backfill.service.spec";

/** `F4.311` PR 5a — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — the calc backfill walk", () => {
  it("returns no continuation for a run that is not claimable", () => aRunThatIsNotQueuedReturnsNoContinuation());
  it("refuses a job that names another point than its run", () => aPayloadNamingAnotherPointIsRefused());
  it("never writes more than 500 rows in one chunk", () => noWriteExceeds500Rows());
  it("writes progress only after each chunk's values (progress lags the write)", () => progressLagsTheWrite());
  it("records the chunk's last bucket as done_through", () => progressNamesTheChunksLastBucket());
  it("writes the formula's value at every bucket", () => everyRowCarriesTheFormulasValue());
  it("stops at the next chunk when the run is gone", () => aDeletedRunStopsAtTheNextChunk());
  it("writes no terminal status when it stops", () => aStoppedWalkDoesNotFinishTheRun());
  it("refreshes the aggregates once over (from, to)", () => theWindowIsRefreshedOnceFromTo());
  it("marks a finished walk done", () => aFinishedWalkMarksTheRunDone());
  it("resumes a retry after done_through", () => aRetryResumesAfterDoneThrough());
  it("writes nothing at an instant whose input is stale", () => aStaleInstantWritesNothing());
  it("fails the run with the error's name only", () => aThrowFailsTheRunByErrorName());
  it("rethrows without the original message", () => aThrowIsRethrownWithoutItsMessage());
  it("fails a point with no active definition", () => aPointWithNoDefinitionFails());
  it("writes a streaming point at its inputs' stored times", () => aStreamingPointWritesAtItsInputTimes());
});
