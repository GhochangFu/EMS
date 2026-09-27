import { describe, it } from "vitest";

import {
  assertCreateAnswersAMappedDuplicateAsTheRuledConflict,
  assertCreateRethrowsAForeignKeyViolationByIdentity,
  assertUpdateAnswersAMappedDuplicateAsTheRuledConflict,
  assertUpdateRethrowsAForeignKeyViolationByIdentity,
} from "./rtus.service.conflict.spec";

/**
 * `F4.141` — Vitest entry point for the service-boundary wiring of
 * `translateRtuUniqueConflict`. Assertions live in the sibling `.spec`
 * (ADR 0014, AGENTS.md §4.6). One claim per `it`.
 */
describe("F4.141 — RtusAdminService's .catch sites", () => {
  it("create answers a mapped duplicate with the ruled 409", async () => {
    await assertCreateAnswersAMappedDuplicateAsTheRuledConflict();
  });

  it("create re-throws a foreign-key violation by identity", async () => {
    await assertCreateRethrowsAForeignKeyViolationByIdentity();
  });

  it("update answers a mapped duplicate with the ruled 409", async () => {
    await assertUpdateAnswersAMappedDuplicateAsTheRuledConflict();
  });

  it("update re-throws a foreign-key violation by identity", async () => {
    await assertUpdateRethrowsAForeignKeyViolationByIdentity();
  });
});
