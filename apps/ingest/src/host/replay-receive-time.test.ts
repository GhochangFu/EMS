import { describe, it } from "vitest";

import {
  assertALiveBatchCarriesTheDrainInstant,
  assertAPreAmendmentLineIsDroppedNotGuessed,
  assertASpilledBatchKeepsTheReceiveTimeTheFailedWriteUsed,
  assertNoDeviceTimeRoundTripsToAtAbsent,
  assertReplayedRowWithoutDeviceTimeHasNullDeviceTime,
  assertReplayingOneSegmentTwiceWritesOneRow,
  assertReplayKeepsTheOriginalReceiveTime,
} from "./replay-receive-time.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * **One `it()` per claim, deliberately.** The buffer suites run many blocks
 * inside one `it()`, so a mutation that reddens a late block is
 * indistinguishable from one that reddens the first. ADR 0016 Amendment 5's
 * claims each get their own case so a mutation can be shown to redden the
 * assertion that owns it.
 */
describe("ADR 0016 Amendment 5 — the segment line carries the receive time", () => {
  it("replays a spilled sample with its original receive time, not the replay instant", async () => {
    await assertReplayKeepsTheOriginalReceiveTime();
  });

  it("writes one row when the same segment is replayed twice (Amendment 4 decision 5)", async () => {
    await assertReplayingOneSegmentTwiceWritesOneRow();
  });

  it("round-trips a sample with no device time to at absent", async () => {
    await assertNoDeviceTimeRoundTripsToAtAbsent();
  });

  it("resolves that replayed sample to a null device_time, not the spill instant", async () => {
    await assertReplayedRowWithoutDeviceTimeHasNullDeviceTime();
  });

  it("drops a pre-amendment line (at, no rx) rather than guessing what its at meant", async () => {
    await assertAPreAmendmentLineIsDroppedNotGuessed();
  });

  it("stamps a live batch with the drain instant (ADR 0061 decision 2)", async () => {
    await assertALiveBatchCarriesTheDrainInstant();
  });

  it("buffers a failed batch with the receive time the failed write used, so replay lands on its key", async () => {
    await assertASpilledBatchKeepsTheReceiveTimeTheFailedWriteUsed();
  });
});
