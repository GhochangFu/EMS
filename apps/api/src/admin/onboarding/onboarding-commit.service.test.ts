import { describe, it } from "vitest";

import {
  assertADraftWithoutATypeIsAssertedAsEmpty,
  assertAnOpenParentChoiceIsTheValidateGates400,
  assertAnOpenParentChoiceOpensNoTransaction,
  assertARefusedLocationTypeNeverOpensTheTransaction,
  assertATreeGuardRaceAnswersTheConflict,
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

describe("F4.243 (ADR 0098 Amendment 2) - the commit maps the tree guard's race refusal", () => {
  it("a 23514 from locations_tree_guard answers the 409 refusal body", async () => {
    await assertATreeGuardRaceAnswersTheConflict();
  });
});

describe("F4.243 review #4 - the commit's validate reads the parent candidates", () => {
  it("an absent parentCode under an active root is the validate gate's 400 with the parent field error", async () => {
    await assertAnOpenParentChoiceIsTheValidateGates400();
  });

  it("and the transaction never opens", async () => {
    await assertAnOpenParentChoiceOpensNoTransaction();
  });
});
