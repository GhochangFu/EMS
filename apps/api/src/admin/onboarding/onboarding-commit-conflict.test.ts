import { describe, it } from "vitest";

import {
  assertACommitCollisionIsAFieldErrorNotAServerFault,
  assertADifferentSqlstatePassesThrough,
  assertAMappedConstraintWithoutASqlstatePassesThrough,
  assertAnUnmappedConstraintPassesThrough,
  assertEveryMappedConstraintBecomesItsOwnFieldError,
  assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing,
  assertNothingFromTheDriverErrorReachesTheClient,
  assertTheMapMatchesTheAuthoredReachableList,
} from "./onboarding-commit-conflict.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * One `it()` per claim, and the first one is the only one that runs the
 * service: the rest would all stay green if `commit` stopped catching, so the
 * split matters more here than the count does.
 */
describe("onboarding commit unique-constraint conflicts (F4.109)", () => {
  it("answers a duplicate value inside the transaction with a per-field 400", async () => {
    await assertACommitCollisionIsAFieldErrorNotAServerFault();
  });

  it("holds exactly the constraint names the authored census lists", () => {
    assertTheMapMatchesTheAuthoredReachableList();
  });

  it("gives each mapped constraint its own field and its own sentence", () => {
    assertEveryMappedConstraintBecomesItsOwnFieldError();
  });

  // Word-list check, not a semantic one — the spec's docblock says what it does
  // and does not cover.
  it("keeps the obvious cross-tenant phrasing out of every global message", () => {
    assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing();
  });

  it("echoes no part of the driver's error back to the client", () => {
    assertNothingFromTheDriverErrorReachesTheClient();
  });

  it("passes a mapped constraint name carrying no SQLSTATE straight through", () => {
    assertAMappedConstraintWithoutASqlstatePassesThrough();
  });

  it("passes a different SQLSTATE straight through", () => {
    assertADifferentSqlstatePassesThrough();
  });

  it("passes a 23505 on an unmapped constraint straight through", () => {
    assertAnUnmappedConstraintPassesThrough();
  });
});
