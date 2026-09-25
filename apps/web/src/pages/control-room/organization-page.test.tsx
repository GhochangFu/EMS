// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  anUnreadableOrganizationShowsNoOtherSites,
  anUnreadableOrganizationShowsTheEmptyCard,
  cleanupPage,
  oneOrganizationRendersNoBreadcrumb,
  oneSiteSkipsToTheSite,
  siteCardsLinkToTheSiteLevel,
  theAssetsReadIsNarrowedToTheOrganization,
  theBreadcrumbNamesTheRootAndTheOrganization,
  theRailIsToldTheAssetsArePending,
  theRailReceivesTheOrganizationsAssetIds,
} from "./organization-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U3 ControlRoomOrganizationPage", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("G1 links each site card to /control-room/site/:id", async () => {
    await siteCardsLinkToTheSiteLevel();
  });

  it("G2 skips to the site when the organization holds one", async () => {
    await oneSiteSkipsToTheSite();
  });

  it("G3a shows the empty card for an organization outside the list", async () => {
    await anUnreadableOrganizationShowsTheEmptyCard();
  });

  it("G3b links no other organization's site for an organization outside the list", async () => {
    await anUnreadableOrganizationShowsNoOtherSites();
  });

  it("G4a narrows the assets read to the organization", async () => {
    await theAssetsReadIsNarrowedToTheOrganization();
  });

  it("G4b passes the organization's asset ids to the rail", async () => {
    await theRailReceivesTheOrganizationsAssetIds();
  });

  it("G5 tells the rail the assets read is pending", async () => {
    await theRailIsToldTheAssetsArePending();
  });

  it("B1 names Control Room as a link and the organization as the current crumb", async () => {
    await theBreadcrumbNamesTheRootAndTheOrganization();
  });

  it("B2 renders no breadcrumb for a one-organization scope", async () => {
    await oneOrganizationRendersNoBreadcrumb();
  });
});
