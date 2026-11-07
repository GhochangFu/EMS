import { describe, it } from "vitest";

import {
  runListedPlainIsServedTests,
  runStringFalseIsInvalidTests,
  runTheCheckReadsTheResolvedHostTests,
  runTlsRtuIsUnaffectedTests,
  runUnlistedPlainIsSkippedTests,
} from "./bindings-plaintext.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host binding plan — plain MQTT (ADR 0114 decision 3)", () => {
  it("B1 skips an unlisted tls:false RTU as plaintext-host-not-allowed", () => {
    runUnlistedPlainIsSkippedTests();
  });
  it("B2 serves a listed tls:false RTU on a scheme-keyed endpoint", () => {
    runListedPlainIsServedTests();
  });
  it("B3 leaves a TLS RTU and its endpoint key unchanged", () => {
    runTlsRtuIsUnaffectedTests();
  });
  it("B4 checks the host the connection uses", () => {
    runTheCheckReadsTheResolvedHostTests();
  });
  it("B5 refuses the string \"false\" as an invalid config", () => {
    runStringFalseIsInvalidTests();
  });
});
