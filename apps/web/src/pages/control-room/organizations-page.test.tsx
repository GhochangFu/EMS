// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFailedReadShowsTheUnavailableCard,
  anEmptyScopeDoesNotRedirect,
  anEmptyScopeShowsTheNoSitesCard,
  aPendingReadDecidesNothing,
  cleanupPage,
  entryDecidesNothingWhilePending,
  entryRendersTheEstateForManyOrganizations,
  entryRendersTheOrganizationInPlace,
  entryRendersTheSiteInPlace,
  entryShowsTheNoSitesCardWithoutABackLink,
  oneOrganizationSkipsToIt,
  oneSiteSkipsToTheSite,
  theOrganizationsLevelRendersTheEstate,
} from "./organizations-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.66 U3 ControlRoomOrganizationsPage", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("O1 renders the estate for two organizations (F3.72 D1)", async () => {
    await theOrganizationsLevelRendersTheEstate();
  });

  it("O3 skips to the organization when there is one", async () => {
    await oneOrganizationSkipsToIt();
  });

  it("O4 skips to the site when there is one", async () => {
    await oneSiteSkipsToTheSite();
  });

  it("O5a shows the no-sites card with a link to /", async () => {
    await anEmptyScopeShowsTheNoSitesCard();
  });

  it("O5b does not redirect an empty scope", async () => {
    await anEmptyScopeDoesNotRedirect();
  });

  it("O6 shows the status line and decides nothing while the read is pending", async () => {
    await aPendingReadDecidesNothing();
  });

  it("E1 shows the unavailable card when the read fails", async () => {
    await aFailedReadShowsTheUnavailableCard();
  });
});

describe("F3.72 D1 ControlRoomOrganizationsPage entry (at /, in place)", () => {
  afterEach(() => {
    cleanupPage();
  });

  it("renders the organization level in place, the URL staying /", async () => {
    await entryRendersTheOrganizationInPlace();
  });

  it("renders the site level in place, the URL staying /", async () => {
    await entryRendersTheSiteInPlace();
  });

  it("renders the estate for many organizations", async () => {
    await entryRendersTheEstateForManyOrganizations();
  });

  it("shows the no-sites card without a link back to itself", async () => {
    await entryShowsTheNoSitesCardWithoutABackLink();
  });

  it("decides nothing while the read is pending", async () => {
    await entryDecidesNothingWhilePending();
  });
});
