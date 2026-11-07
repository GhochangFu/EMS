import { describe, it } from "vitest";

import {
  runListedPlainIsServedTests,
  runOneKeyMeansOneConnectionTests,
  runPlainNeverSendsEnvCredentialsTests,
  runTheCheckReadsTheMergedConfigTests,
  runTlsRtuCannotJoinAPlainEndpointTests,
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
  it("B6 never sends the env credentials to a plain stored host (review M2)", () => {
    runPlainNeverSendsEnvCredentialsTests();
  });
  it("B7 keeps a TLS RTU out of a plain endpoint's key (review M1)", () => {
    runTlsRtuCannotJoinAPlainEndpointTests();
  });
  it("B8 checks the merged config, not the raw row (review L1)", () => {
    runTheCheckReadsTheMergedConfigTests();
  });
  it("B9 refuses a row whose connection differs from its endpoint's", () => {
    runOneKeyMeansOneConnectionTests();
  });
});
