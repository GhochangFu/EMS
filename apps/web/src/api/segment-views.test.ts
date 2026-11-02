import { afterEach, describe, it, vi } from "vitest";

import {
  aNonOkAnswerClearsTheSessionAndThrows,
  fetchesTheRouteWithTheQueryKeys,
  onlyA404IsNotFound,
  refusesABodyOutsideTheContract,
  sendsNoAbsentKey,
  theQueryKeyNamesTheSiteAndTheQuery,
} from "./segment-views.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.302 segment-views web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches GET /control-room/sites/:id/segment-views with the query's keys", async () => {
    await fetchesTheRouteWithTheQueryKeys();
  });

  it("sends no absent key", async () => {
    await sendsNoAbsentKey();
  });

  it("keys the query by the site and the whole query", () => {
    theQueryKeyNamesTheSiteAndTheQuery();
  });

  it("clears a refused session and throws an ApiError with the status", async () => {
    await aNonOkAnswerClearsTheSessionAndThrows();
  });

  it("treats only a 404 as not found", () => {
    onlyA404IsNotFound();
  });

  it("refuses a body outside the contract", async () => {
    await refusesABodyOutsideTheContract();
  });
});
