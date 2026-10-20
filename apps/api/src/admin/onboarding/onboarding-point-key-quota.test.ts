import { describe, it } from "vitest";

import {
  assertADraftOfExistingCodesPassesAtTheLimit,
  assertAddPointKeyRefusesAtTheOrganizationLimit,
  assertAddPointKeysPassesForAnExemptActor,
  assertAddPointKeysRefusesOverTheLimit,
  assertAnExemptActorPassesBothLimits,
  assertOnlyDistinctCodesTheCatalogLacksCount,
  assertProposeCommitRefusesOverTheLimit,
  assertTheLimitsArePinned,
  assertThePerCommitLimitIsInclusive,
  assertThePerOrganizationLimitCountsEarlierAdditions,
} from "./onboarding-point-key-quota.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the point-key growth quota (F4.111, ADR 0104)", () => {
  it("Q-U1 pins 200 per commit and 1,000 per organization", () => {
    assertTheLimitsArePinned();
  });

  it("Q-U2 counts only distinct codes the catalog lacks", () => {
    assertOnlyDistinctCodesTheCatalogLacksCount();
  });

  it("Q-U3 passes exactly 200 new keys and refuses 201", () => {
    assertThePerCommitLimitIsInclusive();
  });

  it("Q-U4 counts the organization's earlier additions", () => {
    assertThePerOrganizationLimitCountsEarlierAdditions();
  });

  it("Q-U5 passes a draft of existing codes at the limit", () => {
    assertADraftOfExistingCodesPassesAtTheLimit();
  });

  it("Q-U6 exempts a global admin from both limits", () => {
    assertAnExemptActorPassesBothLimits();
  });

  it("Q-U7 add_point_keys refuses over the limit and writes nothing", async () => {
    await assertAddPointKeysRefusesOverTheLimit();
  });

  it("Q-U8 add_point_keys writes for an exempt actor", async () => {
    await assertAddPointKeysPassesForAnExemptActor();
  });

  it("Q-U9 add_point_key refuses at the organization limit", async () => {
    await assertAddPointKeyRefusesAtTheOrganizationLimit();
  });

  it("Q-U10 propose_commit refuses a draft over the limit", async () => {
    await assertProposeCommitRefusesOverTheLimit();
  });
});
