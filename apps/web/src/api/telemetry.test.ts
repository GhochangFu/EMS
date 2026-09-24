import { afterEach, describe, it, vi } from "vitest";

import {
  hitsTheAtInstantPath,
  parsesTheResponseThroughTheSharedSchema,
  sendsAtVerbatim,
  sendsOneRefsPerRefRoundTripping,
  throwsOnANon2xxResponse,
} from "./telemetry.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.28 telemetry web client — fetchPointValuesAt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the read to /api/v1/telemetry/points/at-instant", async () => {
    await hitsTheAtInstantPath();
  });

  it("sends at verbatim", async () => {
    await sendsAtVerbatim();
  });

  it("sends one refs per ref, round-tripping the encoded separator", async () => {
    await sendsOneRefsPerRefRoundTripping();
  });

  it("parses the response through the shared schema", async () => {
    await parsesTheResponseThroughTheSharedSchema();
  });

  it("throws on a non-2xx response", async () => {
    await throwsOnANon2xxResponse();
  });
});
