import { afterEach, describe, it, vi } from "vitest";

import {
  healthSummarySendsBothFilters,
  healthSummarySendsLocationIdAlone,
  healthSummarySendsNoQueryWhenUnfiltered,
  healthSummarySendsOrganizationIdAlone,
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
