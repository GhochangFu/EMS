import { afterEach, describe, it, vi } from "vitest";

import {
  fetchDashboardsSendsAssetIdAlone,
  fetchDashboardsSendsNoQueryWhenUnfiltered,
  fetchDashboardsSendsOrganizationIdThenAssetId,
} from "./dashboards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6).
 * No `@vitest-environment` docblock: this file wants the project's `node`
 * default, not jsdom.
 */
describe("F3.31 dashboards web client — assetId reaches the wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends ?assetId= alone when only the asset is given", async () => {
    await fetchDashboardsSendsAssetIdAlone();
  });

  it("sends ?organizationId=&assetId= in that order when both are given", async () => {
    await fetchDashboardsSendsOrganizationIdThenAssetId();
  });

  it("sends no query string at all when unfiltered", async () => {
    await fetchDashboardsSendsNoQueryWhenUnfiltered();
  });
});
