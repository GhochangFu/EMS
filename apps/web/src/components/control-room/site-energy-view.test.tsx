// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedOrganizationReadIsAFixedSentence,
  aFlatSiteShowsNoSiteRanking,
  aParentSiteShowsTheSiteRanking,
  bothReadsAreLockedToTheSite,
  theKpiTilesRender,
} from "./site-energy-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the site's Energy sub-tab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("locks both energy reads to the site, with no organizationId", async () => {
    await bothReadsAreLockedToTheSite();
  });

  it("shows no site ranking on a flat site", async () => {
    await aFlatSiteShowsNoSiteRanking();
  });

  it("shows the site ranking on a parent with readable children", async () => {
    await aParentSiteShowsTheSiteRanking();
  });

  it("renders a fixed sentence when the organization read fails", async () => {
    await aFailedOrganizationReadIsAFixedSentence();
  });

  it("renders the KPI tiles from the view read", async () => {
    await theKpiTilesRender();
  });
});
