import { describe, it } from "vitest";

import {
  assertADuplicateRtuCodeBecomesTheRuledConflict,
  assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged,
  assertANonObjectRejectionIsReturnedUnchanged,
  assertAnotherConstraintsDuplicateIsReturnedUnchanged,
  assertNothingFromTheDriverErrorReachesTheClient,
  assertTheRefusalNamesNoOtherTenant,
} from "./rtus-conflict.spec";

/**
 * `F4.60` — Vitest entry point for the `rtus_rtu_code_idx` translation.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 *
 * One claim per `it`: `expect` throws, so two claims in one block would hide the
 * second whenever the first fails.
 */
describe("F4.60 — translateRtuCodeCollision", () => {
  it("answers a duplicate rtu_code with the ruled 409", () => {
    assertADuplicateRtuCodeBecomesTheRuledConflict();
  });

  it("returns another constraint's 23505 unchanged, by identity", () => {
    assertAnotherConstraintsDuplicateIsReturnedUnchanged();
  });

  it("returns a 23503 naming the same index unchanged, by identity", () => {
    assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged();
  });

  it("returns a non-object rejection unchanged", () => {
    assertANonObjectRejectionIsReturnedUnchanged();
  });

  it("passes nothing from the driver error to the client", () => {
    assertNothingFromTheDriverErrorReachesTheClient();
  });

  it("names no other tenant in the refusal", () => {
    assertTheRefusalNamesNoOtherTenant();
  });
});
