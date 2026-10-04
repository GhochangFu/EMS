// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  anotherOrganizationMountsANewSiteMap,
  aPendingKpiReadRendersNoPanels,
  anUnreadableOrganizationRendersNoPanels,
  theDashboardsListReadsByTheOrganizationId,
  theHealthSectionReadsByTheOrganizationId,
  theTrendReadsByTheOrganizationId,
  anUnreadableOrganizationRendersNoRail,
  anUnreadableOrganizationShowsNoOtherSites,
  aPendingKpiReadShowsOnlyTheLoadingLine,
  anUnreadableOrganizationShowsTheEmptyCard,
  cleanupPage,
  oneOrganizationRendersNoBreadcrumb,
  oneSiteSkipsToTheSite,
  siteCardsLinkToTheSiteLevel,
  theBreadcrumbNamesTheRootAndTheOrganization,
  theOrganizationIdPropOverridesTheRoute,
  thePageMakesNoAssetsRead,
  theRailIsSentNoAssetIds,
  theRailReadsByTheOrganizationId,
  theSiteMapReadsByTheOrganizationId,
  theSiteMapSitsAboveTheSiteCards,
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

  it("G4a gives the rail the route's organization id", async () => {
    await theRailReadsByTheOrganizationId();
  });

  it("G4b sends the rail no asset ids", async () => {
    await theRailIsSentNoAssetIds();
  });

  it("G5 makes no asset read", async () => {
    await thePageMakesNoAssetsRead();
  });

  it("B1 names Control Room as a link and the organization as the current crumb", async () => {
    await theBreadcrumbNamesTheRootAndTheOrganization();
  });

  it("B2 renders no breadcrumb for a one-organization scope", async () => {
    await oneOrganizationRendersNoBreadcrumb();
  });

  it("B3 shows only the loading line while the KPI read is pending (D1)", async () => {
    await aPendingKpiReadShowsOnlyTheLoadingLine();
  });

  it("G6 renders no alarms rail for an organization outside the list", async () => {
    await anUnreadableOrganizationRendersNoRail();
  });

  it("G7 reads the organizationId prop over the route parameter (F3.72 D1)", async () => {
    await theOrganizationIdPropOverridesTheRoute();
  });

  it("P1 gives Asset health the organization id (F3.72 D3)", async () => {
    await theHealthSectionReadsByTheOrganizationId();
  });

  it("P2 gives the load trend the organization id (F3.72 D3)", async () => {
    await theTrendReadsByTheOrganizationId();
  });

  it("P3 gives the dashboards list the organization id (F3.72 D3)", async () => {
    await theDashboardsListReadsByTheOrganizationId();
  });

  it("P4 renders no panel for an organization outside the list (F3.72 D3)", async () => {
    await anUnreadableOrganizationRendersNoPanels();
  });

  it("P5 renders no panel while the KPI read is pending (F3.72 D3)", async () => {
    await aPendingKpiReadRendersNoPanels();
  });

  it("P6 gives the site map the organization id (F3.79)", async () => {
    await theSiteMapReadsByTheOrganizationId();
  });

  it("P7 places the site map above the site cards and the alarms rail (F3.79)", async () => {
    await theSiteMapSitsAboveTheSiteCards();
  });

  it("P8 mounts a new site map for another organization (F3.79)", async () => {
    await anotherOrganizationMountsANewSiteMap();
  });
});
