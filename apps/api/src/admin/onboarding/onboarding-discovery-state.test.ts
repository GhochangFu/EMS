import { describe, it } from "vitest";

import * as S from "./onboarding-discovery-state.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b — readDiscovery", () => {
  it("reads a stored discovery as the DTO without queuedAt", () => S.aStoredDiscoveryReadsAsTheDto());
  it("fails closed on a malformed blob", () => S.aMalformedBlobReadsAsNull());
  it("reads an absent key as null", () => S.anAbsentKeyReadsAsNull());
  it("reads the stored shape with its stored-only keys, and fails closed", () => S.aStoredBlobReadsWithItsStoredOnlyKeys());
});

describe("F3.24b — discoveryIsBusy (decisions #7)", () => {
  it("a recent queued discovery is busy", () => S.aRecentQueuedDiscoveryIsBusy());
  it("a queued discovery past its 30-minute stale bound is not busy", () => S.aQueuedDiscoveryPastItsStaleBoundIsNotBusy());
  it("a running discovery inside its bound is busy", () => S.aRunningDiscoveryInsideItsBoundIsBusy());
  it("a running discovery past its bound is not busy", () => S.aRunningDiscoveryPastItsBoundIsNotBusy());
  it("a running discovery with no startedAt is busy", () => S.aRunningDiscoveryWithNoStartIsBusy());
  it("a done or failed discovery is not busy", () => S.aFinishedDiscoveryIsNotBusy());
  it("no discovery is not busy", () => S.noDiscoveryIsNotBusy());
});

describe("F3.24b — withDiscoveryOf keeps the worker's result across a locked write", () => {
  it("takes the locked row's result over the merged draft's", () => S.withDiscoveryOfTakesTheLockedRowsResult());
  it("adds the locked row's result when the merge has none", () =>
    S.withDiscoveryOfAddsTheLockedRowsResultWhenTheMergeHasNone());
  it("drops a result the locked row lacks", () => S.withDiscoveryOfDropsAResultTheLockedRowLacks());
  it("leaves the merged draft untouched", () => S.withDiscoveryOfLeavesTheMergedDraftUntouched());
});
