import { describe, it } from "vitest";

import {
  aHungPostIsAbortedAtTwentySeconds,
  anAllFutureRx200IsRetryLater,
  onlyAValid200sDateIsTrusted,
  anOversizeBatchIsSplit,
  everyOutcomeIsHandled,
  onlyBacklogBatchesAreThrottled,
  postsAreSerialisedLiveFirst,
  retryAfterGatesTheNextPost,
  theBodyIsAValidGzipBatch,
  theDeviceKeyIsStampedOnAOneDeviceEndpoint,
  theFloorRateWaitsTenSeconds,
} from "./uplink-client.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge uplink client (ADR 0123 decisions 4 and 9, plan T5.4)", () => {
  it("posts one gzip batch the receiver's schema accepts, rx unchanged", async () => {
    await theBodyIsAValidGzipBatch();
  });

  it("stamps deviceKey on a one-device endpoint (M5)", async () => {
    await theDeviceKeyIsStampedOnAOneDeviceEndpoint();
  });

  it("flags and throttles backlog batches only (C3)", async () => {
    await onlyBacklogBatchesAreThrottled();
  });

  it("waits 10 s for a full batch at the 50/s floor (C3)", async () => {
    await theFloorRateWaitsTenSeconds();
  });

  it("handles every row of the outcome table (C4)", async () => {
    await everyOutcomeIsHandled();
  });

  it("honours Retry-After as a not-before time, capped at 5 min", async () => {
    await retryAfterGatesTheNextPost();
  });

  it("aborts a post at 20 s", async () => {
    await aHungPostIsAbortedAtTwentySeconds();
  });

  it("splits a body over 256 KiB", async () => {
    await anOversizeBatchIsSplit();
  });

  it("keeps one post in flight, live ahead of backlog", async () => {
    await postsAreSerialisedLiveFirst();
  });

  it("passes only a schema-valid 200's Date header to the clock guard", async () => {
    await onlyAValid200sDateIsTrusted();
  });

  it("treats a 200 that refused every sample as futureRx as retry-later", async () => {
    await anAllFutureRx200IsRetryLater();
  });
});
