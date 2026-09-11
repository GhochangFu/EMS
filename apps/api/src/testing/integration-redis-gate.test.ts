import { describe, it } from "vitest";

import {
  assertCiIsDetectedByValueNotTruthiness,
  assertRefusalThrowsWithTheCallersReason,
  assertSkipReturnsUndefinedAndExplainsItself,
  assertUrlIsReturnedVerbatim,
  assertVerdictIsAsymmetric,
} from "./integration-redis-gate.spec";

/**
 * F4.24 (ADR 0063 decision 13) — Vitest entry point for the integration-test
 * Redis gate. Assertions live in the sibling `.spec` (§4.6/ADR 0014); this
 * file only runs them.
 *
 * Note what is *absent*: this suite needs no `REDIS_URL` and no Redis. It
 * tests the gate, not anything behind it, so it runs everywhere — which is
 * the point. A guard whose own tests skip when the environment is bare is a
 * guard nothing checks in exactly the situation it exists for.
 */
describe("F4.24 — the integration-test Redis gate", () => {
  it("treats an unset REDIS_URL differently in CI than locally", () => {
    assertVerdictIsAsymmetric();
  });

  it("detects CI by exact value, not truthiness", () => {
    assertCiIsDetectedByValueNotTruthiness();
  });

  it("returns the URL unaltered", () => {
    assertUrlIsReturnedVerbatim();
  });

  it("throws in CI rather than registering a skipped suite", () => {
    assertRefusalThrowsWithTheCallersReason();
  });

  it("returns undefined and explains itself when skipping locally", () => {
    assertSkipReturnsUndefinedAndExplainsItself();
  });
});
