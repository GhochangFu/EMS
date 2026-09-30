// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  noArgumentIsTheEnterpriseSummary,
  theFilterReachesTheFetcher,
  theKeyCarriesTheLocationId,
  theKeyCarriesTheOrganizationId,
} from "./use-asset-health.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.72 U1 useHealthSummary filter and key", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the filter to the fetcher whole", async () => {
    await theFilterReachesTheFetcher();
  });

  it("fetches again for another organization on the same client", async () => {
    await theKeyCarriesTheOrganizationId();
  });

  it("fetches again for another location on the same client", async () => {
    await theKeyCarriesTheLocationId();
  });

  it("reads the enterprise summary with no argument", async () => {
    await noArgumentIsTheEnterpriseSummary();
  });
});
