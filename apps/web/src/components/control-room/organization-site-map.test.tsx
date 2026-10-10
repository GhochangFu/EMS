// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedPollKeepsTheMap,
  aFailedReadShowsTheErrorState,
  anOrganizationWithNoPinShowsTheEmptyState,
  aPendingReadShowsTheLoadingLine,
  cleanupSiteMap,
  scrollWheelZoomIsOffAndTheMapHasItsHeight,
  showsOnlyThisOrganizationsPins,
  theMapFitsThisOrganizationsSites,
  theOrgMapFilterReadsTheSubtree,
  thePopupOpensTheSiteLevel,
} from "./organization-site-map.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.79 OrganizationSiteMap", () => {
  afterEach(() => {
    cleanupSiteMap();
  });

  it("S1 shows only this organization's pins", async () => {
    await showsOnlyThisOrganizationsPins();
  });

  it("S2 links a pin's popup to the site's Control Room level", async () => {
    await thePopupOpensTheSiteLevel();
  });

  it("S3 opens on this organization's sites", async () => {
    await theMapFitsThisOrganizationsSites();
  });

  it("S4 turns off scroll-wheel zoom and gives the map its height", async () => {
    await scrollWheelZoomIsOffAndTheMapHasItsHeight();
  });

  it("S5 shows the empty state for an organization with no pin", async () => {
    await anOrganizationWithNoPinShowsTheEmptyState();
  });

  it("S6 shows the error state for a failed read", async () => {
    await aFailedReadShowsTheErrorState();
  });

  it("S7 shows only the loading line while the read is pending", async () => {
    await aPendingReadShowsTheLoadingLine();
  });

  it("S8 keeps the map when a poll fails after a good read", async () => {
    await aFailedPollKeepsTheMap();
  });

  it("F6 the filter lists the nodes it is handed and reads the chosen subtree (F2.10)", async () => {
    await theOrgMapFilterReadsTheSubtree();
  });
});
