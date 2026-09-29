import { afterEach, describe, it, vi } from "vitest";

import {
  hitsTheAtInstantPath,
  latestHitsTheLatestPath,
  latestParsesTheResponse,
  latestRefusesABodyWithoutItems,
  latestSendsOneParameterPerIdAndKey,
  latestSendsTheWindow,
  latestThrowsOnANon2xxResponse,
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

describe("F4.176 telemetry web client — fetchPointsLatest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the read to /api/v1/telemetry/points/latest", async () => {
    await latestHitsTheLatestPath();
  });

  it("sends one assetIds per id and one pointKeys per key, in order", async () => {
    await latestSendsOneParameterPerIdAndKey();
  });

  it("sends windowMinutes, 15 by default", async () => {
    await latestSendsTheWindow();
  });

  it("parses the response through the shared schema", async () => {
    await latestParsesTheResponse();
  });

  it("refuses a body without items", async () => {
    await latestRefusesABodyWithoutItems();
  });

  it("throws on a non-2xx response", async () => {
    await latestThrowsOnANon2xxResponse();
  });
});
