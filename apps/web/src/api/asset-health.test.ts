import { afterEach, describe, it, vi } from "vitest";

import {
  badActorsSendsEachFilterOnlyWhenSet,
  badActorsThrowsOnA500,
  badActorsThrowsOnAWrongShape,
  healthSummarySendsBothFilters,
  healthSummarySendsLocationIdAlone,
  healthSummarySendsNoQueryWhenUnfiltered,
  healthSummarySendsOrganizationIdAlone,
  inputsReadsTheAssetsPath,
  inputsThrowsOnA500,
  inputsThrowsOnAWrongShape,
} from "./asset-health.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.72 U1 asset health web client — the summary filter reaches the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends no query string at all when unfiltered", async () => {
    await healthSummarySendsNoQueryWhenUnfiltered();
  });

  it("sends ?locationId= alone when only the location is given", async () => {
    await healthSummarySendsLocationIdAlone();
  });

  it("sends ?organizationId= alone when only the organization is given", async () => {
    await healthSummarySendsOrganizationIdAlone();
  });

  it("sends both filters when both are given", async () => {
    await healthSummarySendsBothFilters();
  });
});

describe("E1.8b T2.1 asset health web client — the health inputs and bad-actors reads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads one asset's inputs from its own path", async () => {
    await inputsReadsTheAssetsPath();
  });

  it("throws on an inputs answer of the wrong shape", async () => {
    await inputsThrowsOnAWrongShape();
  });

  it("throws on an inputs 500 with the route's name", async () => {
    await inputsThrowsOnA500();
  });

  it("sends each bad-actors filter only when it is set", async () => {
    await badActorsSendsEachFilterOnlyWhenSet();
  });

  it("throws on a bad-actors answer of the wrong shape", async () => {
    await badActorsThrowsOnAWrongShape();
  });

  it("throws on a bad-actors 500 with the route's name", async () => {
    await badActorsThrowsOnA500();
  });
});
