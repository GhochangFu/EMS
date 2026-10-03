import { describe, it } from "vitest";

import * as spec from "./keycloak-gate.spec";

/**
 * `F3.78` U3 — Vitest entry point for the Keycloak integration-test gate.
 * Assertions live in the sibling `.spec` (ADR 0014). Needs no Keycloak: it
 * tests the gate, so it runs everywhere.
 */
describe("F3.78 U3 — the Keycloak integration-test gate", () => {
  describe("the verdict", () => {
    it("skips locally when KEYCLOAK_ADMIN_URL is unset", () => {
      spec.assertAnUnsetUrlSkipsLocally();
    });

    it("refuses in CI when KEYCLOAK_ADMIN_URL is unset", () => {
      spec.assertAnUnsetUrlRefusesInCi();
    });

    it("treats a blank KEYCLOAK_ADMIN_URL as unset", () => {
      spec.assertABlankUrlCountsAsUnset();
    });

    it("runs with the built config when the environment is complete", () => {
      spec.assertACompleteConfigRuns();
    });

    it("refuses a misconfigured URL locally", () => {
      spec.assertAMisconfiguredUrlRefusesLocally();
    });

    it("refuses a set URL with no secret", () => {
      spec.assertAMissingSecretBesideASetUrlRefuses();
    });

    it("honours KEYCLOAK_INTEGRATION=skip in CI", () => {
      spec.assertADeclaredSkipIsHonouredInCi();
    });

    it("does not let a declared skip hide a misconfigured URL", () => {
      spec.assertADeclaredSkipDoesNotHideAMisconfiguration();
    });

    it("declares a skip only for the exact value skip", () => {
      spec.assertOnlyTheExactSkipValueDeclaresASkip();
    });

    it("detects CI by exact value, not truthiness", () => {
      spec.assertCiIsDetectedByValueNotTruthiness();
    });
  });

  describe("requireKeycloak", () => {
    it("writes the one D6 line and returns undefined when skipping locally", () => {
      spec.assertTheLocalSkipWritesTheOneLine();
    });

    it("throws in CI with the caller's reason", () => {
      spec.assertTheCiRefusalThrowsWithTheCallersReason();
    });

    it("throws locally on a misconfigured URL", () => {
      spec.assertAMisconfigurationThrowsLocally();
    });

    it("names no value in the misconfiguration message", () => {
      spec.assertTheMisconfigurationMessageCarriesNoValue();
    });

    it("writes a verdict line for a declared skip", () => {
      spec.assertADeclaredSkipWritesAVerdictLine();
    });

    it("returns the config silently when complete", () => {
      spec.assertACompleteConfigIsReturned();
    });
  });
});
