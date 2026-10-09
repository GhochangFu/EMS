import { afterEach, describe, it, vi } from "vitest";

import { fetchesTheKpisRouteForTheAsset, refusesABodyOutsideTheContract, throwsOnANonOkStatus } from "./asset-kpis.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node` default.
 */
describe("F2.33 asset KPI web client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches GET /assets/:assetId/kpis with no query string", async () => {
    await fetchesTheKpisRouteForTheAsset();
  });

  it("refuses a body outside the strict contract", async () => {
    await refusesABodyOutsideTheContract();
  });

  it("throws on a non-OK status", async () => {
    await throwsOnANonOkStatus();
  });
});
