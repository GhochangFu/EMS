import { describe, it } from "vitest";

import {
  aListedPlainRtuPasses,
  aNonMqttRtuIsNotChecked,
  aPlainRtuWithNoHostIsRefused,
  aStringFalseIsTheSchemaIssueOnly,
  aTlsRtuIsUnaffected,
  anUnlistedPlainRtuIsRefused,
} from "./onboarding-validate-plaintext.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.326 — the validator and plain MQTT (ADR 0114 decision 5)", () => {
  it("V1 refuses an unlisted tls:false RTU with the fixed message", anUnlistedPlainRtuIsRefused);
  it("V2 passes a listed tls:false RTU", aListedPlainRtuPasses);
  it("V3 leaves a TLS RTU alone", aTlsRtuIsUnaffected);
  it("V4 reports the string \"false\" as the schema issue only", aStringFalseIsTheSchemaIssueOnly);
  it("V5 refuses tls:false with no host (ruling 6)", aPlainRtuWithNoHostIsRefused);
  it("V6 checks MQTT RTUs only", aNonMqttRtuIsNotChecked);
});
