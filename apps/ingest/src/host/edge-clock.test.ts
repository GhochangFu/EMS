import { describe, it } from "vitest";

import {
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
});
