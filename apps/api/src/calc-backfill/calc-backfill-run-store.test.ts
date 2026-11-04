import { describe, it } from "vitest";

import {
  aDoneRunIsNeverProjected,
  aProjectedFailureCarriesAFinishTime,
  aQueuedRunPastTheBoundReadsAsFailedNotStarted,
  aRecentQueuedRunStaysQueued,
  aRunningRunPastTheStaleBoundReadsAsFailedStale,
  aRunningRunWithAFreshHeartbeatStaysRunning,
  aStaleRunKeepsItsProgress,
} from "./calc-backfill-run-store.spec";

/** `F4.311` PR 6b review — Vitest entry point; assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — the run store's latest-run read projects an orphaned run as failed", () => {
  it("a running run with a fresh heartbeat stays running", aRunningRunWithAFreshHeartbeatStaysRunning);
  it("a running run past the stale bound reads as failed / stale", aRunningRunPastTheStaleBoundReadsAsFailedStale);
  it("a stale run keeps its progress", aStaleRunKeepsItsProgress);
  it("a recent queued run stays queued", aRecentQueuedRunStaysQueued);
  it("a queued run past the bound reads as failed / not started", aQueuedRunPastTheBoundReadsAsFailedNotStarted);
  it("a projected failure carries a finish time", aProjectedFailureCarriesAFinishTime);
  it("a done run is never projected", aDoneRunIsNeverProjected);
});
