// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aGroupTabLinkIsNamedByItsStatus,
  aPendingMarkersReadDrawsNoMarker,
  aTabOutsideScopeSaysSoNeverAZero,
  aTabSwitchMakesNoSecondMarkersRead,
  theOverviewLinkHasNoMarker,
  aDashboardWithNoTabsRendersAsToday,
  aFailedRefetchKeepsTheCanvas,
  aFailedRefetchShowsNoAlert,
  anUnknownTabRedirectsToTheBarePath,
  aPendingReadDoesNotRedirect,
  aTabOnAnUntabbedDashboardRedirects,
  aTabSegmentSelectsThatTab,
  cleanupView,
  linkOpensTheViewer,
  noEditLink,
  pendingReadRendersNoCanvas,
  pendingReadSaysLoading,
  readCarriesTheSiteOrganization,
  rejectedReadRendersNoCanvas,
  rejectedReadShowsTheApiMessage,
  resolvedReadRendersTheCanvas,
  theBarePathSelectsTheFirstTab,
  theSelectedTabIsCurrent,
  titleIsTheDashboardName,
  tryAgainInvalidatesOnlyTheResolveRead,
  tryAgainInvalidatesTheResolveRead,
  tryAgainRereadsTheDashboard,
  twoTabsRenderAsLinks,
} from "./site-dashboard-view.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.69 SiteDashboardView", () => {
  afterEach(() => {
    cleanupView();
  });

  it("S1 reads the dashboard by slug and the site's organization id", async () => {
    await readCarriesTheSiteOrganization();
  });

  it("S2 titles the section with the dashboard's name", async () => {
    await titleIsTheDashboardName();
  });

  it("S3 links Open in Dashboards to the viewer with the organization id", async () => {
    await linkOpensTheViewer();
  });

  it("S4a says loading while the read is pending", async () => {
    await pendingReadSaysLoading();
  });

  it("S4b renders no canvas while the read is pending", async () => {
    await pendingReadRendersNoCanvas();
  });

  it("S5 hands the resolved DTO to the live canvas", async () => {
    await resolvedReadRendersTheCanvas();
  });

  it("S6a shows the API's message in an alert on a rejected read", async () => {
    await rejectedReadShowsTheApiMessage();
  });

  it("S6b renders no canvas on a rejected read", async () => {
    await rejectedReadRendersNoCanvas();
  });

  it("S7a re-reads the dashboard on Try again and renders the answer", async () => {
    await tryAgainRereadsTheDashboard();
  });

  it("S7b invalidates the site page's resolve read on Try again", async () => {
    await tryAgainInvalidatesTheResolveRead();
  });

  it("S7c invalidates only the resolve read, not a wider or unrelated key", async () => {
    await tryAgainInvalidatesOnlyTheResolveRead();
  });

  it("S8 shows no Edit dashboard link", async () => {
    await noEditLink();
  });

  it("S9a keeps the canvas when a background refetch fails", async () => {
    await aFailedRefetchKeepsTheCanvas();
  });

  it("S9b shows no alert when a background refetch fails", async () => {
    await aFailedRefetchShowsNoAlert();
  });
});

describe("F3.73 D10 SiteDashboardView tabs", () => {
  afterEach(() => {
    cleanupView();
  });

  it("T1 renders two tabs as links to their :tab paths, in sortOrder order", async () => {
    await twoTabsRenderAsLinks();
  });

  it("T2 marks the selected tab aria-current", async () => {
    await theSelectedTabIsCurrent();
  });

  it("T3 hands the canvas the :tab segment's key", async () => {
    await aTabSegmentSelectsThatTab();
  });

  it("T4 selects the first tab by sortOrder at the bare path", async () => {
    await theBarePathSelectsTheFirstTab();
  });

  it("T5 redirects an unknown tab to the bare path", async () => {
    await anUnknownTabRedirectsToTheBarePath();
  });

  it("T6 renders a dashboard with no tabs as before", async () => {
    await aDashboardWithNoTabsRendersAsToday();
  });

  it("T7 redirects a :tab segment on a dashboard with no tabs", async () => {
    await aTabOnAnUntabbedDashboardRedirects();
  });

  it("T8 does not redirect while the read is pending", async () => {
    await aPendingReadDoesNotRedirect();
  });

  it("F3.77 M1 a group tab link is named by its status and shows the count", async () => {
    await aGroupTabLinkIsNamedByItsStatus();
  });

  it("F3.77 M2 the Overview link has no marker", async () => {
    await theOverviewLinkHasNoMarker();
  });

  it("F3.77 M3 a tab outside scope says so, never a zero", async () => {
    await aTabOutsideScopeSaysSoNeverAZero();
  });

  it("F3.77 M4 a tab switch makes no second markers read", async () => {
    await aTabSwitchMakesNoSecondMarkersRead();
  });

  it("F3.77 M5 a pending markers read draws no marker", async () => {
    await aPendingMarkersReadDrawsNoMarker();
  });
});
