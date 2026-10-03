import { describe, it } from "vitest";

import {
  assertADraftChangedAfterTheReadIsRefusedUnderTheLock,
  assertADraftChangedBeforeTheReadIsRefusedWithoutATransaction,
  assertAnUnchangedDraftProceedsPastTheLock,
  assertTheButtonPathTakesNoLock,
} from "./onboarding-commit-proposed.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("OnboardingCommitService.commitProposed — the proposal survives to the commit (F3.21)", () => {
  it("refuses a draft changed before its read, without a transaction", async () => {
    await assertADraftChangedBeforeTheReadIsRefusedWithoutATransaction();
  });

  it("refuses a draft changed after its read, under the row lock", async () => {
    await assertADraftChangedAfterTheReadIsRefusedUnderTheLock();
  });

  it("goes on past the lock for an unchanged draft", async () => {
    await assertAnUnchangedDraftProceedsPastTheLock();
  });

  it("takes no lock on the Commit button path", async () => {
    await assertTheButtonPathTakesNoLock();
  });
});
