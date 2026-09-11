import { describe, it } from "vitest";

import {
  runBindingQuerySelectsKeyVersionTests,
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
});
