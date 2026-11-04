import { afterEach, describe, it, vi } from "vitest";

import {
  answersTheParsedLists,
  readsTheSiteTrendPointsRoute,
  refusesABodyWithoutSegments,
  throwsOnANonOkStatus,
} from "./site-trend-points.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F4.306 U10 site trend-points web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads GET /control-room/sites/:locationId/trend-points", async () => {
    await readsTheSiteTrendPointsRoute();
  });

  it("answers the parsed lists", async () => {
    await answersTheParsedLists();
  });

  it("refuses a body without segments", async () => {
    await refusesABodyWithoutSegments();
  });

  it("throws on a non-OK status, naming the route and the status", async () => {
    await throwsOnANonOkStatus();
  });
});
