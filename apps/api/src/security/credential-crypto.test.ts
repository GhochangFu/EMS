import { describe, it } from "vitest";

import {
  runConstructorAcceptsOpenWindowTests,
  runConstructorRefusesShortPreviousKeyTests,
  runConstructorRefusesVersionZeroWindowTests,
  runCredentialCryptoTests,
  runCurrentCiphertextLabelledPreviousTests,
  runCurrentKeyVersionDefaultTests,
  runCurrentKeyVersionFromEnvTests,
  runEncryptStampsConfiguredVersionTests,
  runNullVersionRefusedTests,
  runPreviousKeyRoundTripTests,
  runUnconfiguredKeyConstructsTests,
  runWrongVersionLabelRefusedTests,
} from "./credential-crypto.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("credential-crypto", () => {
  it("round-trips encrypted RTU credentials (ADR 0012)", () => {
    runCredentialCryptoTests();
  });

  it("stamps the configured key version, never a literal (decision 3)", () => {
    runEncryptStampsConfiguredVersionTests();
  });

  it("reports the configured key version", () => {
    runCurrentKeyVersionFromEnvTests();
  });

  it("reports version 1 when the version is unset", () => {
    runCurrentKeyVersionDefaultTests();
  });

  it("reads a previous-key ciphertext at its stored version (decision 4)", () => {
    runPreviousKeyRoundTripTests();
  });

  it("refuses a stored version no loaded key writes, instead of guessing (decision 4)", () => {
    runWrongVersionLabelRefusedTests();
  });

  it("does not fall back to the current key for a previous-version label", () => {
    runCurrentCiphertextLabelledPreviousTests();
  });

  it("refuses a null stored version rather than defaulting it to 1", () => {
    runNullVersionRefusedTests();
  });

  it("refuses to construct on a previous key at version 0 (decision 5)", () => {
    runConstructorRefusesVersionZeroWindowTests();
  });

  it("constructs on an open rotation window", () => {
    runConstructorAcceptsOpenWindowTests();
  });

  it("refuses to construct on a previous key that is not 32 bytes (decision 5)", () => {
    runConstructorRefusesShortPreviousKeyTests();
  });

  it("constructs with no key configured, and says it is unconfigured", () => {
    runUnconfiguredKeyConstructsTests();
  });
});
