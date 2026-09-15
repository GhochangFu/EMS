import { describe, it } from "vitest";

import {
  assertAConfigErrorFailsRatherThanSkipping,
  assertAMissingBucketFailsWithoutEchoingTheEndpoint,
  assertCiIsDetectedByValueNotTruthiness,
  assertEndpointIsReturnedVerbatim,
  assertRefusalThrowsWithTheCallersReason,
  assertRunReturnsTheParsedConfig,
  assertSkipReturnsUndefinedAndExplainsItself,
  assertVerdictIsAsymmetric,
} from "./integration-storage-gate.spec";

/**
 * `F3.3` (ADR 0066 decision 10) — Vitest entry point for the integration-test
 * object-storage gate. Assertions live in the sibling `.spec` (§4.6/ADR 0014);
 * this file only runs them.
 *
 * Note what is *absent*: this suite needs no `OBJECT_STORAGE_ENDPOINT` and no
 * MinIO. It tests the gate, not anything behind it, so it runs everywhere —
 * which is the point. A guard whose own tests skip when the environment is
 * bare is a guard nothing checks in exactly the situation it exists for.
 */
describe("F3.3 — the integration-test object-storage gate", () => {
  it("treats an unset OBJECT_STORAGE_ENDPOINT differently in CI than locally", () => {
    assertVerdictIsAsymmetric();
  });

  it("detects CI by exact value, not truthiness", () => {
    assertCiIsDetectedByValueNotTruthiness();
  });

  it("returns the endpoint unaltered", () => {
    assertEndpointIsReturnedVerbatim();
  });

  it("throws in CI rather than registering a skipped suite", () => {
    assertRefusalThrowsWithTheCallersReason();
  });

  it("returns undefined and names all six variables when skipping locally", () => {
    assertSkipReturnsUndefinedAndExplainsItself();
  });

  it("returns the parsed StorageConfig when the environment is complete", () => {
    assertRunReturnsTheParsedConfig();
  });

  it("fails rather than skipping when a set endpoint is misconfigured", () => {
    assertAConfigErrorFailsRatherThanSkipping();
  });

  it("names the missing variable without echoing the endpoint or the secret", () => {
    assertAMissingBucketFailsWithoutEchoingTheEndpoint();
  });
});
