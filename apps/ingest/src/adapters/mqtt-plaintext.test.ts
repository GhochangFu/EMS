import { describe, it } from "vitest";

import {
  runEndpointKeyPerSchemeTests,
  runPlaintextWarningTests,
  runSchemePerTlsTests,
} from "./mqtt-plaintext.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("mqtt adapter — plain MQTT (ADR 0114 decision 3)", () => {
  it("A1 builds mqtt:// only for tls:false, with no rejectUnauthorized", async () => {
    await runSchemePerTlsTests();
  });
  it("A2 warns once per instance with host and port only", async () => {
    await runPlaintextWarningTests();
  });
  it("A3 keys a plain endpoint with its scheme and leaves TLS keys alone", () => {
    runEndpointKeyPerSchemeTests();
  });
});
