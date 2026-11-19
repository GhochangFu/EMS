// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import {
  aHeaderClickFiltersTheMap,
  aMoveToAnotherOrganizationClearsTheFilter,
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
  theHeadingsCountSitesAndALiveGroupMovesWhole,
  theMapIsSyncedToTheSiteRead,
  theSubtitleCountsTwelveSites,
  everySiteLiveRendersNoNotLiveGroup,
  liveSitesComeFirstInTheirOwnGroup,
  theStripPercentsAddUpTo100,
  noLiveSiteRendersNoLiveGroup,
  theKpiStripReplacesTheLiveStatusStrip,
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
  theCostChartSitsBetweenTheAlarmsAndAssetHealth,
  theFindingsCardSitsDirectlyAboveAssetHealth,
  theBadActorsCardSitsDirectlyAfterAssetHealth,
  theDegradationCardFollowsBadActors,
  theLoadCardAndKwTileFollowTheSites,
} from "./organization-page.spec";

// `F4.337` — the daily cost chart draws through ECharts, which jsdom cannot (no canvas).
vi.mock("echarts-for-react", () => ({ default: () => null }));

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

  it("L1 draws the KPI strip from the organization view in place of the live status strip (F4.317)", async () => {
    await theKpiStripReplacesTheLiveStatusStrip();
  });

  it("P10 draws the cost chart between the alarms and Asset health (F4.337)", async () => {
    await theCostChartSitsBetweenTheAlarmsAndAssetHealth();
  });

  it("P11 draws one compact findings card for the organization directly above Asset health (E1.9e, E1.9g)", async () => {
    await theFindingsCardSitsDirectlyAboveAssetHealth();
  });

  it("P12 draws one Bad actors card directly after Asset health, the load trend after it (E1.8c, E1.9g)", async () => {
    await theBadActorsCardSitsDirectlyAfterAssetHealth();
  });

  it("P13 draws one Trending toward a limit card after Bad actors, fresh per organization (E1.5b)", async () => {
    await theDegradationCardFollowsBadActors();
  });

  it("L2 shows the live sites first, in their own group (F4.259)", async () => {
    await liveSitesComeFirstInTheirOwnGroup();
  });

  it("L3 renders no live group when no site is live (F4.259)", async () => {
    await noLiveSiteRendersNoLiveGroup();
  });

  it("L4 renders no not-live group when every site is live (F4.259)", async () => {
    await everySiteLiveRendersNoNotLiveGroup();
  });

  it("L5 keeps the strip's two percents at a sum of 100 (F4.259)", async () => {
    await theStripPercentsAddUpTo100();
  });

  it("P9 hands the map the site read's dataUpdatedAt (F4.260)", async () => {
    await theMapIsSyncedToTheSiteRead();
  });
});

describe("F4.375 — the organization page follows its sites' energy (ADR 0133 Amendment 2 Q5, Q7)", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("no site shows energy: no load card, no kW-only strip tile", async () => {
    await theLoadCardAndKwTileFollowTheSites(false);
  });

  it("one site shows energy: the load card and the kW tile stay", async () => {
    await theLoadCardAndKwTileFollowTheSites(true);
  });
});

describe("F4.240 — site cards grouped under their parent (ADR 0139 decisions 13–16)", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("GP1 reads '12 sites' in the subtitle and draws no card for a station", async () => {
    await theSubtitleCountsTwelveSites();
  });

  it("GP2 sets the map's filter to the parent a header click names; a second click clears it", async () => {
    await aHeaderClickFiltersTheMap();
  });

  it("GP3 counts sites in the headings; a group with one live site sits under Live, whole", async () => {
    await theHeadingsCountSitesAndALiveGroupMovesWhole();
  });

  it("GP4 clears the map's filter on a move to another organization", async () => {
    await aMoveToAnotherOrganizationClearsTheFilter();
  });
});
