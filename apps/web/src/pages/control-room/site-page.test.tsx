// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedRefetchKeepsTheBody,
  aFailedRefetchShowsNoNotAvailableCard,
  aNullSlugLinksToNoDashboard,
  aPendingKpiReadShowsOnlyTheLoadingLine,
  aNullSlugShowsTheGeneratedInterim,
  aRejectedKpiReadShowsNoInterimBody,
  aRejectedKpiReadShowsTheUnavailableCard,
  aRejectedReadShowsNoInterimBody,
  aRejectedReadShowsTheNotAvailableCard,
  aRejectedResolveReadIsNotRetried,
  aSiteOutsideTheListShowsTheNotAvailableCard,
  builtinFiltersByTheAreaRule,
  builtinListsTheSevenSmocPages,
  builtinUnknownShowsItsBanner,
  cleanupPage,
  dashboardLinksToTheDashboard,
  dashboardOutOfScopeShowsItsBanner,
  dashboardRemovedShowsItsBanner,
  generatedShowsTheInterimCard,
  noNoticeRendersNoBanner,
  theBreadcrumbNamesEveryLevel,
  theHeaderNamesTheSite,
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

  it("V1a renders the generated interim card with a link to the site dashboard", async () => {
    await generatedShowsTheInterimCard();
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

  it("V5 lists the seven SMOC pages for a global scope", async () => {
    await builtinListsTheSevenSmocPages();
  });

  it("V6 filters the SMOC pages by the per-area rule", async () => {
    await builtinFiltersByTheAreaRule();
  });

  it("V7 links the dashboard kind to /dashboards/<slug>?organizationId=<org>", async () => {
    await dashboardLinksToTheDashboard();
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
});
