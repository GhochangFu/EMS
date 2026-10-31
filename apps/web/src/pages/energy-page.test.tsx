// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCostRendersInTheOrganizationsCurrency,
  aFullScopeRendersNoNote,
  aMeasuredRatioRendersOnTheEnergyPage,
  aNullCostRendersTheDashWithoutThrowing,
  aNullPfRendersTheDashAndTheReason,
  aPartialScopeRendersTheNote,
  aPfRendersToTwoDecimals,
  anEmptyPreviousPeriodSaysSo,
  anUnconfiguredWindowShowsTheDashAndTheReason,
  noViewIsFetchedWithoutAnOrganization,
  thePeakTimeIsFormattedInTheViewsZone,
  theOnlyOrganizationIsPreselectedAndFetched,
  theRollupTileNamesLevelBucketAndZone,
  theTotalTileShowsTheChangeAgainstThePreviousPeriod,
} from "./energy-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("F2.8 energy centre PUE tile", () => {
  it("renders a measured ratio to two decimals", async () => {
    await aMeasuredRatioRendersOnTheEnergyPage();
  });

  it("renders a dash and the not-configured reason when the API returns null", async () => {
    await anUnconfiguredWindowShowsTheDashAndTheReason();
  });
});

describe("E4.1c energy centre cost tile", () => {
  it("E1 renders the cost in the organization's currency and names the tariff on the ribbon", async () => {
    await aCostRendersInTheOrganizationsCurrency();
  });

  it("E2 renders the dash and no tariff, without throwing, when the cost fields are null", async () => {
    await aNullCostRendersTheDashWithoutThrowing();
  });
});

describe("F4.298 the Energy page on GET /reports/energy/view", () => {
  it("formats the peak time in the view's zone, not the browser's", async () => {
    await thePeakTimeIsFormattedInTheViewsZone();
  });

  it("shows the total's change against the previous period", async () => {
    await theTotalTileShowsTheChangeAgainstThePreviousPeriod();
  });

  it("says there is no data for an empty previous period", async () => {
    await anEmptyPreviousPeriodSaysSo();
  });

  it("names the level, the bucket and the zone on the rollup tile", async () => {
    await theRollupTileNamesLevelBucketAndZone();
  });

  it("renders the partial-access note", async () => {
    await aPartialScopeRendersTheNote();
  });

  it("renders no partial-access note for a full scope", async () => {
    await aFullScopeRendersNoNote();
  });

  it("renders the dash and the reason when no pf point is in scope", async () => {
    await aNullPfRendersTheDashAndTheReason();
  });

  it("renders the average PF to two decimals", async () => {
    await aPfRendersToTwoDecimals();
  });

  it("fetches no view while no organization is chosen", async () => {
    await noViewIsFetchedWithoutAnOrganization();
  });

  it("preselects the only organization and fetches its view", async () => {
    await theOnlyOrganizationIsPreselectedAndFetched();
  });
});
