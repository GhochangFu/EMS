import { describe, it } from "vitest";

import {
  runBindingQuerySelectsKeyVersionTests,
  runCredentialFingerprintBindsTheRtuTests,
  runCredentialFingerprintCiphertextPresenceTests,
  runCredentialFingerprintFollowsIvAndVersionTests,
  runCredentialFingerprintHoldsNoSecretTests,
  runCredentialFingerprintNoBlobTests,
  runCredentialFingerprintOnlyBoundRtusTests,
  runEnvFallbackWarningTests,
  runMqttPlainErrorNoDetailTests,
  runMqttResolverReceivesStoredVersionTests,
  runMqttVersionErrorDetailTests,
  runNoWarningWhenCredentialFromDbTests,
  runNoWarningWithoutConfigRowTests,
  runNonMqttDecryptorReceivesStoredVersionTests,
  runNonMqttPlainErrorNoDetailTests,
  runNonMqttVersionErrorDetailTests,
} from "./bindings-credentials.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host binding plan — credentials (ADR 0062)", () => {
  it("selects the stored key version in the binding query (decision 3)", () => {
    runBindingQuerySelectsKeyVersionTests();
  });

  it("hands the stored key version to the ADR 0012 decryptor", () => {
    runNonMqttDecryptorReceivesStoredVersionTests();
  });

  it("hands the stored key version to the MQTT connection resolver", () => {
    runMqttResolverReceivesStoredVersionTests();
  });

  it("warns when a configured RTU falls back to the environment credential (decision 9)", () => {
    runEnvFallbackWarningTests();
  });

  it("does not warn when the credential came from the row", () => {
    runNoWarningWhenCredentialFromDbTests();
  });

  it("does not warn for an RTU with no config row", () => {
    runNoWarningWithoutConfigRowTests();
  });

  it("names an unloaded key version in the MQTT skip detail", () => {
    runMqttVersionErrorDetailTests();
  });

  it("leaves the MQTT skip detail unset for any other cipher failure", () => {
    runMqttPlainErrorNoDetailTests();
  });

  it("names an unloaded key version in the ADR 0012 skip detail", () => {
    runNonMqttVersionErrorDetailTests();
  });

  it("leaves the ADR 0012 skip detail unset for any other cipher failure", () => {
    runNonMqttPlainErrorNoDetailTests();
  });

  // F4.333 (ADR 0129 decision 4): what makes a credential write reach a running endpoint.
  it("moves the credential fingerprint with one RTU's IV or key version, not with row order", () => {
    runCredentialFingerprintFollowsIvAndVersionTests();
  });

  it("builds the credential fingerprint from no plaintext and no ciphertext", () => {
    runCredentialFingerprintHoldsNoSecretTests();
  });

  it("keeps a blob-less RTU's fingerprint stable, and moves it when a blob appears", () => {
    runCredentialFingerprintNoBlobTests();
  });

  it("adds a mark only for a bound RTU (an endpoint-credential-conflict RTU stays bound)", () => {
    runCredentialFingerprintOnlyBoundRtusTests();
  });

  it("moves the fingerprint when a ciphertext disappears under the same IV", () => {
    runCredentialFingerprintCiphertextPresenceTests();
  });

  it("binds each mark to its RTU, so swapped blobs move the fingerprint", () => {
    runCredentialFingerprintBindsTheRtuTests();
  });
});
