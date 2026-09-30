// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedRefetchKeepsTheBody,
  aFailedRefetchShowsNoNotAvailableCard,
  aNullSlugLinksToNoDashboard,
  aPendingKpiReadDoesNotRedirectATab,
  aPendingKpiReadShowsOnlyTheLoadingLine,
  aNullSlugShowsTheGeneratedInterim,
  aRejectedKpiReadShowsNoInterimBody,
  aRejectedKpiReadShowsTheUnavailableCard,
  aRejectedReadShowsNoInterimBody,
  aRejectedReadShowsTheNotAvailableCard,
  aRejectedResolveReadIsNotRetried,
  aPendingResolveReadDoesNotRedirect,
  aRejectedReadWithATabMountsNoSmocView,
  aRejectedReadWithATabShowsTheNotAvailableCard,
  aSiteOutsideTheListShowsTheNotAvailableCard,
  aTabOnAGeneratedSiteMountsNoBodyAtTheTabUrl,
  aTabOnAGeneratedSiteRedirectsToTheBarePath,
  anUnknownTabRedirectsToTheBarePath,
  aBuiltinOnANonSmocSiteHostsTheGeneratedView,
  aBuiltinOnANonSmocSiteMountsNoSmocView,
  aTabOnANonSmocBuiltinSiteRedirectsToTheBarePath,
  builtinHostsSmocSiteViewOnTheOverview,
  builtinPassesTheScope,
  builtinPassesTheTabParam,
  builtinUnknownShowsItsBanner,
  cleanupPage,
  dashboardOutOfScopeShowsItsBanner,
  dashboardRemovedShowsItsBanner,
  dashboardRendersSiteDashboardView,
  dashboardShowsNoInterimCard,
  dashboardShowsNoNoticeBanner,
  generatedRendersTheComponentWithLocationId,
  noNoticeRendersNoBanner,
  theBreadcrumbNamesEveryLevel,
  theHeaderNamesTheSite,
  theLocationIdPropOverridesTheRoute,
  aPendingResolveReadMountsNoAssetsView,
  aRejectedReadWithTheAssetsTabShowsTheNotAvailableCard,
  theAssetsTabDoesNotRedirectOnAGeneratedSite,
  theAssetsTabDoesNotRedirectOnTheSmocSite,
  theAssetsTabHostsTheAssetsView,
  theAssetsTabListsNoDashboards,
  theAssetsTabOnADashboardSiteHostsNoDashboardView,
  theSiteViewEntryIsCurrentOnASmocTab,
  theSiteViewEntryListsTheSiteDashboards,
  theStripLinksBackToTheSiteView,
  theStripLinksToTheAssetsTab,
} from "./site-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U4 ControlRoomSitePage", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("V1a hosts GeneratedSiteView with the page's locationId", async () => {
    await generatedRendersTheComponentWithLocationId();
  });

  it("V1b renders no notice banner when the notice is null", async () => {
    await noNoticeRendersNoBanner();
  });

  it("V2 renders the dashboard_removed banner", async () => {
    await dashboardRemovedShowsItsBanner();
  });

  it("V3 renders the dashboard_out_of_scope banner, not the dashboard_removed text", async () => {
    await dashboardOutOfScopeShowsItsBanner();
  });

  it("V4 renders the builtin_unknown banner", async () => {
    await builtinUnknownShowsItsBanner();
  });

  it("V5 hosts SmocSiteView for the site on the overview tab at the bare path", async () => {
    await builtinHostsSmocSiteViewOnTheOverview();
  });

  it("V6a passes the tab segment to SmocSiteView", async () => {
    await builtinPassesTheTabParam();
  });

  it("V6b passes the caller's scope to SmocSiteView", async () => {
    await builtinPassesTheScope();
  });

  it("V7 hosts SiteDashboardView with the slug and the site's organization id", async () => {
    await dashboardRendersSiteDashboardView();
  });

  it("V7b shows no interim card and no real dashboards link", async () => {
    await dashboardShowsNoInterimCard();
  });

  it("V7c shows no notice banner for a dashboard view", async () => {
    await dashboardShowsNoNoticeBanner();
  });

  it("V8a shows the not-available card for a rejected resolve read", async () => {
    await aRejectedReadShowsTheNotAvailableCard();
  });

  it("V8b shows no interim body for a rejected resolve read", async () => {
    await aRejectedReadShowsNoInterimBody();
  });

  it("V9 names Control Room and the organization as links and the site as text", async () => {
    await theBreadcrumbNamesEveryLevel();
  });

  it("V10 names the site in the header from the KPI list", async () => {
    await theHeaderNamesTheSite();
  });

  it("V11 shows the not-available card for a site outside the KPI list", async () => {
    await aSiteOutsideTheListShowsTheNotAvailableCard();
  });

  it("V12a shows the Control Room unavailable card for a rejected KPI read", async () => {
    await aRejectedKpiReadShowsTheUnavailableCard();
  });

  it("V12b shows no interim body for a rejected KPI read", async () => {
    await aRejectedKpiReadShowsNoInterimBody();
  });

  it("V13a shows the generated interim for a dashboard view with no slug", async () => {
    await aNullSlugShowsTheGeneratedInterim();
  });

  it("V13b links to no dashboard for a dashboard view with no slug", async () => {
    await aNullSlugLinksToNoDashboard();
  });

  it("V14 calls the resolve client once for a rejected read", async () => {
    await aRejectedResolveReadIsNotRetried();
  });

  it("V15a keeps the site view body when a background refetch fails", async () => {
    await aFailedRefetchKeepsTheBody();
  });

  it("V15b shows no not-available card when a background refetch fails", async () => {
    await aFailedRefetchShowsNoNotAvailableCard();
  });

  it("V16 shows only the loading line while the KPI read is pending (D1)", async () => {
    await aPendingKpiReadShowsOnlyTheLoadingLine();
  });

  it("V17 redirects an unknown tab on a builtin site to the bare site path", async () => {
    await anUnknownTabRedirectsToTheBarePath();
  });

  it("V18a redirects a tab segment on a generated site to the bare site path", async () => {
    await aTabOnAGeneratedSiteRedirectsToTheBarePath();
  });

  it("V18b mounts no generated body at the tab URL", async () => {
    await aTabOnAGeneratedSiteMountsNoBodyAtTheTabUrl();
  });

  it("V19a shows the not-available card at the tab URL for a rejected resolve read", async () => {
    await aRejectedReadWithATabShowsTheNotAvailableCard();
  });

  it("V19b mounts no SMOC view for a rejected resolve read at a tab URL", async () => {
    await aRejectedReadWithATabMountsNoSmocView();
  });

  it("V20 does not redirect while the resolve read is pending", async () => {
    await aPendingResolveReadDoesNotRedirect();
  });

  it("V21a hosts the generated view for a builtin resolve on a non-SMOC site", async () => {
    await aBuiltinOnANonSmocSiteHostsTheGeneratedView();
  });

  it("V21b mounts no SMOC view for a builtin resolve on a non-SMOC site", async () => {
    await aBuiltinOnANonSmocSiteMountsNoSmocView();
  });

  it("V21c redirects a tab segment on a non-SMOC builtin site to the bare site path", async () => {
    await aTabOnANonSmocBuiltinSiteRedirectsToTheBarePath();
  });

  it("V22 does not redirect a tab URL while the KPI read is pending", async () => {
    await aPendingKpiReadDoesNotRedirectATab();
  });

  it("V23 reads the locationId prop over the route parameter (F3.72 D1)", async () => {
    await theLocationIdPropOverridesTheRoute();
  });

  it("A1 hosts SiteAssetsView with the page's locationId at /assets (F3.72 D4)", async () => {
    await theAssetsTabHostsTheAssetsView();
  });

  it("A2 does not redirect /assets on a generated site", async () => {
    await theAssetsTabDoesNotRedirectOnAGeneratedSite();
  });

  it("A3 does not redirect /assets on the SMOC site and mounts no SMOC view", async () => {
    await theAssetsTabDoesNotRedirectOnTheSmocSite();
  });

  it("A4 hosts no dashboard view at /assets on a dashboard site", async () => {
    await theAssetsTabOnADashboardSiteHostsNoDashboardView();
  });

  it("A5 links the strip to the Assets & RTUs tab, Site view current at the bare path", async () => {
    await theStripLinksToTheAssetsTab();
  });

  it("A6 links the strip back to the Site view, Assets & RTUs current at /assets", async () => {
    await theStripLinksBackToTheSiteView();
  });

  it("A7 marks Site view current on a SMOC tab (OQ5)", async () => {
    await theSiteViewEntryIsCurrentOnASmocTab();
  });

  it("A8 shows the not-available card at /assets for a rejected resolve read", async () => {
    await aRejectedReadWithTheAssetsTabShowsTheNotAvailableCard();
  });

  it("A9 mounts no assets view while the resolve read is pending", async () => {
    await aPendingResolveReadMountsNoAssetsView();
  });

  it("A10 lists the site's dashboards on the Site view entry (D7)", async () => {
    await theSiteViewEntryListsTheSiteDashboards();
  });

  it("A11 lists no dashboards on the Assets & RTUs tab", async () => {
    await theAssetsTabListsNoDashboards();
  });
});
