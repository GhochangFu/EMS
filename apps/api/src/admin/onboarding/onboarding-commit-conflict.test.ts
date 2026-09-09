import { describe, it } from "vitest";

import {
  assertACommitCollisionIsAFieldErrorNotAServerFault,
  assertACrossTenantMessageNeverImpliesAnotherOrganization,
  assertADifferentSqlstatePassesThrough,
  assertAMappedConstraintWithoutASqlstatePassesThrough,
  assertAnUnmappedConstraintPassesThrough,
  assertEveryMappedConstraintBecomesItsOwnFieldError,
  assertNothingFromTheDriverErrorReachesTheClient,
  assertTheMapCoversEveryReachableUniqueConstraint,
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

  it("maps every unique constraint a commit can violate, and nothing else", () => {
    assertTheMapCoversEveryReachableUniqueConstraint();
  });

  it("gives each mapped constraint its own field and its own sentence", () => {
    assertEveryMappedConstraintBecomesItsOwnFieldError();
  });

  it("never implies a second organization on a constraint with no organization in its key", () => {
    assertACrossTenantMessageNeverImpliesAnotherOrganization();
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
