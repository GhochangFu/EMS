// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  anUnreadableOrganizationRendersNoRail,
  anUnreadableOrganizationShowsNoOtherSites,
  aPendingKpiReadShowsOnlyTheLoadingLine,
  anUnreadableOrganizationShowsTheEmptyCard,
  cleanupPage,
  oneOrganizationRendersNoBreadcrumb,
  oneSiteSkipsToTheSite,
  siteCardsLinkToTheSiteLevel,
  theBreadcrumbNamesTheRootAndTheOrganization,
  thePageMakesNoAssetsRead,
  theRailIsSentNoAssetIds,
  theRailReadsByTheOrganizationId,
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
});
