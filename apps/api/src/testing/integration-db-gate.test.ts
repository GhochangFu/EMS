import { describe, it } from "vitest";

import {
  assertCiIsDetectedByValueNotTruthiness,
  assertConnectionStringIsReturnedVerbatim,
  assertRefusalThrowsWithTheCallersReason,
  assertSkipReturnsUndefinedAndExplainsItself,
  assertVerdictIsAsymmetric,
} from "./integration-db-gate.spec";

/**
 * ADR 0025 decision 8 (`F4.28`) — Vitest entry point for the extracted
 * integration-test database gate. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 *
 * Note what is *absent*: this suite needs no `DATABASE_URL` and no database. It
 * tests the gate, not anything behind it, so it runs everywhere — which is the
 * point. A guard whose own tests skip when the environment is bare is a guard
 * nothing checks in exactly the situation it exists for.
 */
describe("F4.28 — the integration-test database gate", () => {
  it("treats an unset DATABASE_URL differently in CI than locally", () => {
    assertVerdictIsAsymmetric();
  });

  it("detects CI by exact value, not truthiness", () => {
    assertCiIsDetectedByValueNotTruthiness();
  });

  it("returns the connection string unaltered", () => {
    assertConnectionStringIsReturnedVerbatim();
  });

  it("throws in CI rather than registering a skipped suite", () => {
    assertRefusalThrowsWithTheCallersReason();
  });

  it("returns undefined and explains itself when skipping locally", () => {
    assertSkipReturnsUndefinedAndExplainsItself();
  });
});
