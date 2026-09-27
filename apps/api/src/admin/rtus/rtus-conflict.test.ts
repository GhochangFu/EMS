import { describe, it } from "vitest";

import {
  assertADuplicateExternalRtuIdBecomesTheRuledConflict,
  assertADuplicateLocationCodeBecomesTheRuledConflict,
  assertADuplicateMqttTopicBecomesTheRuledConflict,
  assertADuplicateRtuCodeBecomesTheRuledConflict,
  assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged,
  assertANonObjectRejectionIsReturnedUnchanged,
  assertAnotherConstraintsDuplicateIsReturnedUnchanged,
  assertEveryMappedConstraintAnswersItsOwnMessage,
  assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing,
  assertNothingFromTheDriverErrorReachesTheClient,
  assertTheMapHoldsExactlyTheFourAuthoredConstraints,
} from "./rtus-conflict.spec";

/**
 * `F4.60` / `F4.141` — Vitest entry point for the `bms.rtus` unique-constraint
 * translation. Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 *
 * One claim per `it`: `expect` throws, so two claims in one block would hide the
 * second whenever the first fails.
 */
describe("F4.60 / F4.141 — translateRtuUniqueConflict", () => {
  it("maps exactly the four authored rtus unique constraints", () => {
    assertTheMapHoldsExactlyTheFourAuthoredConstraints();
  });

  it("answers a duplicate rtu_code with the ruled 409", () => {
    assertADuplicateRtuCodeBecomesTheRuledConflict();
  });

  it("answers a duplicate external_rtu_id with the ruled 409", () => {
    assertADuplicateExternalRtuIdBecomesTheRuledConflict();
  });

  it("answers a duplicate mqtt_topic with the ruled 409", () => {
    assertADuplicateMqttTopicBecomesTheRuledConflict();
  });

  it("answers a duplicate code at one location with the ruled 409", () => {
    assertADuplicateLocationCodeBecomesTheRuledConflict();
  });

  it("answers every mapped constraint with its own ruled sentence", () => {
    assertEveryMappedConstraintAnswersItsOwnMessage();
  });

  it("returns another constraint's 23505 unchanged, by identity", () => {
    assertAnotherConstraintsDuplicateIsReturnedUnchanged();
  });

  it("returns a 23503 naming a mapped index unchanged, by identity", () => {
    assertAForeignKeyViolationNamingTheIndexIsReturnedUnchanged();
  });

  it("returns a non-object rejection unchanged", () => {
    assertANonObjectRejectionIsReturnedUnchanged();
  });

  it("passes nothing from the driver error to the client, for any constraint", () => {
    assertNothingFromTheDriverErrorReachesTheClient();
  });

  it("uses no obvious cross-tenant phrasing in a global refusal", () => {
    assertNoGlobalMessageUsesTheObviousCrossTenantPhrasing();
  });
});
