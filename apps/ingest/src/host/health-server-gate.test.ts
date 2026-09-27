import { describe, it } from "vitest";

import {
  runBoundPortTests,
  runForeignHostOverSocketTests,
  runForeignHostRefusedTests,
  runHostPrefixRefusedTests,
  runHostSuffixRefusedTests,
  runLoopbackHostAcceptedTests,
  runMethodOverSocketTests,
  runMethodRefusedTests,
  runMissingHostRefusedTests,
  runNoHostHeaderTests,
  runPathOverSocketTests,
  runPathRefusedTests,
  runRefusalBodyTests,
  runRefusalOrderTests,
  runServedRequestTests,
} from "./health-server-gate.spec.js";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per claim — `assert` throws, so a shared block hides later sites.
 */
describe("health endpoint request gate (F4.61)", () => {
  it("a loopback Host, with or without a port, is served", () => {
    runLoopbackHostAcceptedTests();
  });

  it("a foreign Host is refused 421", () => {
    runForeignHostRefusedTests();
  });

  it("a loopback prefix with a foreign suffix is refused", () => {
    runHostSuffixRefusedTests();
  });

  it("a foreign prefix with a loopback suffix is refused", () => {
    runHostPrefixRefusedTests();
  });

  it("a missing or empty Host is refused", () => {
    runMissingHostRefusedTests();
  });

  it("a method other than GET is refused 405 with Allow: GET", () => {
    runMethodRefusedTests();
  });

  it("only / and /health are served, exactly", () => {
    runPathRefusedTests();
  });

  it("host is checked before method, method before path", () => {
    runRefusalOrderTests();
  });

  it("a refusal body is one fixed line that echoes nothing", () => {
    runRefusalBodyTests();
  });
});

describe("health endpoint request gate over a socket (F4.61)", () => {
  it("reports the bound port, not the 0 it was given", async () => {
    await runBoundPortTests();
  });

  it("serves GET / and GET /health to a loopback Host", async () => {
    await runServedRequestTests();
  });

  it("refuses Host ingest:9102 without the roster", async () => {
    await runForeignHostOverSocketTests();
  });

  it("refuses POST with Allow: GET", async () => {
    await runMethodOverSocketTests();
  });

  it("refuses an unknown path", async () => {
    await runPathOverSocketTests();
  });

  it("refuses an HTTP/1.0 request with no Host", async () => {
    await runNoHostHeaderTests();
  });
});
