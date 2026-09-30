// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadShowsTheErrorState,
  anEmptyTrendShowsTheEmptyState,
  cleanupTrend,
  readsTheTrendForTheOrganization,
  theKeyCarriesTheOrganizationId,
} from "./organization-load-trend.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.72 U4 OrganizationLoadTrend", () => {
  afterEach(() => {
    cleanupTrend();
  });

  it("reads the 60m trend for the organization and draws its points", async () => {
    await readsTheTrendForTheOrganization();
  });

  it("shows the empty state for a trend with no points", async () => {
    await anEmptyTrendShowsTheEmptyState();
  });

  it("shows the error state for a failed read", async () => {
    await aFailedReadShowsTheErrorState();
  });

  it("keeps the estate's cached trend out of the card: the key carries the organization", async () => {
    await theKeyCarriesTheOrganizationId();
  });
});
