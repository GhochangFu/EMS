import { describe, it } from "vitest";

import * as S from "./onboarding-discovery-store.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.24b U3 — OnboardingDiscoveryStore", () => {
  it("the lock key names the organization", () => S.theLockKeyNamesTheOrganization());
  it("the organization lock is a transaction advisory lock on that key", () =>
    S.theOrganizationLockIsATransactionAdvisoryLockOnThatKey());
  it("returns the other sessions' blobs raw", () => S.theOtherSessionsBlobsAreReturnedRaw());
  it("the write replaces only the discovery key", () => S.theWriteReplacesOnlyTheDiscoveryKey());
});
