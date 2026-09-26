import { describe, it } from "vitest";

import {
  assertADraftWithoutATypeIsAssertedAsEmpty,
  assertARefusedLocationTypeNeverOpensTheTransaction,
  assertTheCommitAssertsTheLocationTypeBeforeTheTransaction,
} from "./onboarding-commit.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.157 — OnboardingCommitService asserts the location type", () => {
  it("K1 — asserts the draft's type before the transaction opens", async () => {
    await assertTheCommitAssertsTheLocationTypeBeforeTheTransaction();
  });

  it("K1b — a refused type never opens the transaction", async () => {
    await assertARefusedLocationTypeNeverOpensTheTransaction();
  });

  it("K1c — a draft without a type is asserted as the empty string", async () => {
    await assertADraftWithoutATypeIsAssertedAsEmpty();
  });
});
