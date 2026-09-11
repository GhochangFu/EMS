import { describe, it } from "vitest";

import {
  assertAFailingBatchCostsOnlyItsOwnRules,
  assertARuleWithNoEnabledJoinHasNoEntryAndIsNotUnread,
  assertDuplicatesCollapseBeforeSlicing,
  assertGroupingPreservesTheStatementsOrder,
  assertMoreIdsThanOneBatchIsMoreThanOneStatement,
  assertNoIdsIssuesNoStatement,
  assertTheBatchFitsTheBindLimit,
} from "./channel-reads.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per numbered case, by `F4.105`: `assert` throws, so a single
 * `it()` over seven cases stops at the first failure and every later case is
 * decoration a mutation can never redden.
 */
describe("F3.60 rule-channel batched read", () => {
  it("C1 — issues one statement per batch, not one for every rule id", async () => {
    await assertMoreIdsThanOneBatchIsMoreThanOneStatement();
  });

  it("C2 — collapses duplicate rule ids over the whole list, before slicing", () => {
    assertDuplicatesCollapseBeforeSlicing();
  });

  it("C3 — loses only the rules of a batch that did not return", async () => {
    await assertAFailingBatchCostsOnlyItsOwnRules();
  });

  it("C4 — groups by rule without disturbing the order the statement returned", async () => {
    await assertGroupingPreservesTheStatementsOrder();
  });

  it("C5 — issues no statement for an empty rule list", async () => {
    await assertNoIdsIssuesNoStatement();
  });

  it("C6 — binds fewer parameters than the extended protocol allows", () => {
    assertTheBatchFitsTheBindLimit();
  });

  it("C7 — leaves a rule that joins no enabled channel out of the groups and out of unread", async () => {
    await assertARuleWithNoEnabledJoinHasNoEntryAndIsNotUnread();
  });
});
