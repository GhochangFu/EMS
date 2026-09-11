import { describe, it } from "vitest";

import {
  assertAPartialFailureWarnsOnceAndCarriesOn,
  assertARejectedReadStopsThePhaseAndNotTheTick,
  assertAnEvidencelessTickReadsNoChannels,
  assertAnUnreadRuleIsDecidedAboutNothing,
  assertOneBatchedReadOverTheDistinctEvidencedRules,
  assertThePredicateGetsTheOrganizationFilteredEvidence,
} from "./alarm-lifecycle-raise-retry-channel-batch.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per numbered case, by `F4.105`: `assert` throws, so a single
 * `it()` over six cases stops at the first failure and every later case is
 * decoration a mutation can never redden.
 */
describe("alarm lifecycle: the raise-retry phase reads every evidenced rule's channels in one round trip", () => {
  it("R23 — makes one batched read over the distinct evidenced rules, and no others", async () => {
    await assertOneBatchedReadOverTheDistinctEvidencedRules();
  });

  it("R24 — decides nothing about a rule whose batch did not return, even when a group came back for it", async () => {
    await assertAnUnreadRuleIsDecidedAboutNothing();
  });

  it("R25 — warns once for a partial failure and still decides every rule that was read", async () => {
    await assertAPartialFailureWarnsOnceAndCarriesOn();
  });

  it("R26 — returns from the phase on a rejected read, leaving the escalation phase to run", async () => {
    await assertARejectedReadStopsThePhaseAndNotTheTick();
  });

  it("R27 — hands the predicate the organization-filtered evidence, not the whole group", async () => {
    await assertThePredicateGetsTheOrganizationFilteredEvidence();
  });

  it("R28 — makes no channel read at all in a tick where nothing holds evidence", async () => {
    await assertAnEvidencelessTickReadsNoChannels();
  });
});
