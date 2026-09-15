import { describe, it } from "vitest";

import {
  assertConfiguredClientDoesNotWarnAndBindsTheBucket,
  assertDeleteObjectRemovesTheKey,
  assertEnsureBucketCreatesAMissingBucketOnce,
  assertEnsureBucketOnUnconfiguredClientIsANoop,
  assertEnsureBucketRethrowsAnyOtherError,
  assertEnsureBucketSwallowsTheRaceError,
  assertGetObjectOnAMissingKeyReturnsNull,
  assertHeadObjectOnAMissingKeyReturnsNull,
  assertHeadObjectReportsTheStoredLength,
  assertOperationsUseTheBoundBucket,
  assertPutThenGetRoundTripsTheBytes,
  assertSecondEnsureBucketMakesNoCreateCall,
  assertStorageUnavailableErrorNameIsStable,
  assertUnconfiguredClientWarnsOnceAndBuildsNoOps,
  assertUnconfiguredOperationRejects,
  assertUnconfiguredPutObjectRejectsWithStorageUnavailableError,
  RACE_ERROR_NAMES,
  UNCONFIGURED_OPERATIONS,
} from "./storage-client.spec";

/**
 * F3.3 (ADR 0066 decisions 3, 9) — Vitest entry point for the storage
 * client. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this file
 * only runs them.
 */
describe("F3.3 — storage client over an S3Ops fake", () => {
  it("warns once and builds no S3Ops when unconfigured", () => {
    assertUnconfiguredClientWarnsOnceAndBuildsNoOps();
  });

  it("does not warn and binds the bucket when configured", () => {
    assertConfiguredClientDoesNotWarnAndBindsTheBucket();
  });

  it("rejects putObject with StorageUnavailableError when unconfigured", async () => {
    await assertUnconfiguredPutObjectRejectsWithStorageUnavailableError();
  });

  it.each(UNCONFIGURED_OPERATIONS)(
    "rejects %s with StorageUnavailableError when unconfigured",
    async (operation) => {
      await assertUnconfiguredOperationRejects(operation);
    },
  );

  it("ensureBucket heads then creates a missing bucket", async () => {
    await assertEnsureBucketCreatesAMissingBucketOnce();
  });

  it("a second ensureBucket makes no createBucket call", async () => {
    await assertSecondEnsureBucketMakesNoCreateCall();
  });

  it("ensureBucket makes no S3 call on an unconfigured client", async () => {
    await assertEnsureBucketOnUnconfiguredClientIsANoop();
  });

  it.each(RACE_ERROR_NAMES)(
    "ensureBucket treats %s from a createBucket race as success",
    async (name) => {
      await assertEnsureBucketSwallowsTheRaceError(name);
    },
  );

  it("ensureBucket rethrows any other createBucket error", async () => {
    await assertEnsureBucketRethrowsAnyOtherError();
  });

  it("getObject returns null for a missing key", async () => {
    await assertGetObjectOnAMissingKeyReturnsNull();
  });

  it("headObject returns null for a missing key", async () => {
    await assertHeadObjectOnAMissingKeyReturnsNull();
  });

  it("putObject then getObject round-trips the bytes", async () => {
    await assertPutThenGetRoundTripsTheBytes();
  });

  it("headObject reports the stored length", async () => {
    await assertHeadObjectReportsTheStoredLength();
  });

  it("deleteObject removes the key", async () => {
    await assertDeleteObjectRemovesTheKey();
  });

  it("every bound operation uses the client's bucket", async () => {
    await assertOperationsUseTheBoundBucket();
  });

  it("gives StorageUnavailableError a stable name", () => {
    assertStorageUnavailableErrorNameIsStable();
  });
});
