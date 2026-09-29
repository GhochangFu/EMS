// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aDriftedBatchLeavesTheOtherBatchApplied,
  aFailedBatchLeavesTheOtherBatchApplied,
  aMountBatchesTheLatestReadByFifty,
  aMountReadsNoPerPointRecent,
  aReturnedReadingReachesItsSlice,
  anAbsentPairLeavesItsFieldEmpty,
  hydrationKeepsTheNewestSampleAsLastSeen,
} from "./schematic-telemetry-context.spec";

/**
 * The provider opens a `/ws/telemetry` socket once it tracks an asset. An
 * unmocked `io()` would dial the network and leave a reconnect timer behind.
 */
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: () => undefined,
    disconnect: () => undefined,
  }),
}));

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.176 — the schematic provider's hydration reads (ADR 0074 Amendment 2)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads no per-point /recent on mount", async () => {
    await aMountReadsNoPerPointRecent();
  });

  it("batches the latest-value read by 50 assets", async () => {
    await aMountBatchesTheLatestReadByFifty();
  });

  it("puts a returned reading in its asset's slice", async () => {
    await aReturnedReadingReachesItsSlice();
  });

  it("leaves a pair absent from the response empty", async () => {
    await anAbsentPairLeavesItsFieldEmpty();
  });

  it("applies the other batch when one batch fails", async () => {
    await aFailedBatchLeavesTheOtherBatchApplied();
  });

  it("applies the other batch when one batch drifts in a production build", async () => {
    await aDriftedBatchLeavesTheOtherBatchApplied();
  });

  it("keeps the newest sample as the asset's last-seen time", async () => {
    await hydrationKeepsTheNewestSampleAsLastSeen();
  });
});
