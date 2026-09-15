import { describe, it } from "vitest";

import {
  assertASettledReadLeavesNoPendingTimer,
  assertConfiguredAndOkIsReachableWithItsBucket,
  assertConfiguredAndUnreachableDegrades,
  assertDegradedQueueStaysDegradedBesideReachableStorage,
  assertHangingHeadBucketIsUnreachableInsideTheTimeout,
  assertMissingBucketIsUnreachable,
  assertOkAndReachableStaysOk,
  assertQueueSectionIsCarriedThroughUnchanged,
  assertRejectingHeadBucketIsUnreachable,
  assertTheControllerInjectsTheStorageReaderOptionally,
  assertTheControllerPullsInNoStorageWiring,
  assertUnconfiguredShapeIsExact,
  assertUnconfiguredStorageNeverDegrades,
} from "./storage-health.spec";

/**
 * F3.3 (ADR 0066 decisions 3, 9) — Vitest entry point for the storage
 * health reader and the storage half of the liveness verdict. Assertions
 * live in the sibling `.spec` (§4.6/ADR 0014); this file only runs them.
 * The hanging-read row carries its own 2 s budget, so a bound that stopped
 * working fails here with a name printed, not at vitest's default.
 */
describe("F3.3 — storage health", () => {
  describe("readStorageHealth", () => {
    it("returns the exact unconfigured shape", async () => {
      await assertUnconfiguredShapeIsExact();
    });

    it("reports reachable with the configured bucket when headBucket answers ok", async () => {
      await assertConfiguredAndOkIsReachableWithItsBucket();
    });

    it('reports unreachable when headBucket answers "missing"', async () => {
      await assertMissingBucketIsUnreachable();
    });

    it("reports unreachable when headBucket rejects", async () => {
      await assertRejectingHeadBucketIsUnreachable();
    });

    it("reports unreachable inside the timeout when headBucket never answers", async () => {
      await assertHangingHeadBucketIsUnreachableInsideTheTimeout();
    }, 2_000);

    it("clears the timeout when the read settles", async () => {
      await assertASettledReadLeavesNoPendingTimer();
    });
  });

  describe("withStorageVerdict (Q-B)", () => {
    it("leaves an ok body ok when the store is reachable", () => {
      assertOkAndReachableStaysOk();
    });

    it("reads a configured, unreachable store as degraded", () => {
      assertConfiguredAndUnreachableDegrades();
    });

    it("keeps a degraded queue verdict beside a reachable store", () => {
      assertDegradedQueueStaysDegradedBesideReachableStorage();
    });

    it("never degrades on an unconfigured store", () => {
      assertUnconfiguredStorageNeverDegrades();
    });

    it("carries the queue section through unchanged", () => {
      assertQueueSectionIsCarriedThroughUnchanged();
    });
  });

  describe("health.controller.ts, read as source (F4.20)", () => {
    it("injects StorageHealthService with @Optional()", () => {
      assertTheControllerInjectsTheStorageReaderOptionally();
    });

    it("imports neither storage.module nor aws-s3-ops nor @aws-sdk", () => {
      assertTheControllerPullsInNoStorageWiring();
    });
  });
});
