import { describe, it } from "vitest";

import {
  aCleanMarkIsConsumedOnLoad,
  aPeriodicPersistInFlightCannotOverwriteAResync,
  aBackwardStepConvergesAfterOneTrustedResponse,
  aStaleMarkStartsPastItsMargin,
  aSyncedClockFarFromTheCloudIsSkewed,
  aTrustedCloudTimeEndsUnsyncedFromAMarkAhead,
  anUnreadableMarkWarnsAndCountsAsNone,
  aWallAheadOfTheMarkIsSynced,
  aWallBehindTheMarkIsUnsyncedAndMonotonic,
  theMarkIsWrittenAtMostOnceAMinuteAndOnShutdown,
  theWallPassingTheEstimateResyncs,
} from "./edge-clock.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge clock guard (ADR 0123 decision 8, plan T5.3)", () => {
  it("is synced when the wall clock is ahead of the mark", async () => {
    await aWallAheadOfTheMarkIsSynced();
  });

  it("is unsynced and monotonic when the wall clock starts behind the mark", async () => {
    await aWallBehindTheMarkIsUnsyncedAndMonotonic();
  });

  it("resyncs with no backward step once the wall clock passes the estimate", async () => {
    await theWallPassingTheEstimateResyncs();
  });

  it("writes the mark at most once a minute and on shutdown", async () => {
    await theMarkIsWrittenAtMostOnceAMinuteAndOnShutdown();
  });

  it("warns on an unreadable mark and treats it as none", async () => {
    await anUnreadableMarkWarnsAndCountsAsNone();
  });

  it("starts a stale periodic mark one interval and one tick past it", async () => {
    await aStaleMarkStartsPastItsMargin();
  });

  it("ends unsynced after one trusted cloud time (D9; a mark an hour ahead)", async () => {
    await aTrustedCloudTimeEndsUnsyncedFromAMarkAhead();
  });

  it("converges after a 2 s backward step with one trusted response", async () => {
    await aBackwardStepConvergesAfterOneTrustedResponse();
  });

  it("reports skewed, without shifting rx, when the cloud is over 60 s away", async () => {
    await aSyncedClockFarFromTheCloudIsSkewed();
  });

  it("consumes a clean mark on load, so a later kill cannot reuse it (SF3)", async () => {
    await aCleanMarkIsConsumedOnLoad();
  });

  it("serialises persists, so a periodic write cannot land after a resync's", async () => {
    await aPeriodicPersistInFlightCannotOverwriteAResync();
  });
});
