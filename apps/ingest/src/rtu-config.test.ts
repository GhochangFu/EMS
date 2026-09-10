import { describe, it } from "vitest";

import {
  runCiphertextWithoutKeyTests,
  runConfigRowWithoutCiphertextTests,
  runCurrentCiphertextLabelledPreviousTests,
  runCurrentVersionRoundTripTests,
  runDbCredentialSourceTests,
  runEnvFallbackTests,
  runPreviousKeyRoundTripTests,
  runUnknownStoredVersionRefusedTests,
  runWrongVersionLabelRefusedTests,
} from "./rtu-config.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 *
 * `rtu-config.js` used to export its own checks and `rtu-config.test.js` called
 * the one of them. ADR 0062 decision 2 modifies the file, which ends the
 * "unmodified pilot file" carve-out that justified the inline assertions (plan
 * ruling 4), so they moved here and the `.js` wrapper is deleted.
 */
describe("rtu-config", () => {
  it("resolves MQTT connection settings from env fallbacks", () => {
    runEnvFallbackTests();
  });

  it("round-trips a credential stored at the current version (decision 3)", () => {
    runCurrentVersionRoundTripTests();
  });

  it("reads a previous-key credential at its stored version (decision 4)", () => {
    runPreviousKeyRoundTripTests();
  });

  it("refuses a stored version no loaded key writes, instead of guessing (decision 4)", () => {
    runWrongVersionLabelRefusedTests();
  });

  it("does not fall back to the current key for a previous-version label", () => {
    runCurrentCiphertextLabelledPreviousTests();
  });

  it("names the credential source as db when the blob supplied it (decision 9)", () => {
    runDbCredentialSourceTests();
  });

  it("keeps source meaning the row existed while the credential fell back (decision 9)", () => {
    runConfigRowWithoutCiphertextTests();
  });

  it("falls back to the environment when the key is unconfigured", () => {
    runCiphertextWithoutKeyTests();
  });

  it("refuses a row stored at an unloaded key version", () => {
    runUnknownStoredVersionRefusedTests();
  });
});
