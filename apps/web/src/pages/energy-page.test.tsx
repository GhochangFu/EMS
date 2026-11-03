// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  aCostRendersInTheOrganizationsCurrency,
  aFilterChangeIsWrittenToTheUrl,
  aForeignOrganizationIsNeverSent,
  aForeignSiteIsNeverSent,
  aFullLinkIsTheFirstQuery,
  aFullLinkPressesItsStackAndSort,
  aFullScopeRendersNoNote,
  copyLinkEndsTheFilterBar,
  theDefaultFilterWritesAnEmptySearch,
  theStackChoiceIsWrittenToTheUrl,
  useMyDefaultFilterClearsTheLink,
  aMissingPreviousPowerFactorIsNotCalledZero,
  aMeasuredRatioRendersOnTheEnergyPage,
  aNullCostRendersTheDashWithoutThrowing,
  aNullPfRendersTheDashAndTheReason,
  aPartialScopeRendersTheNote,
  aPfRendersToTwoDecimals,
  anEmptyPreviousPeriodSaysSo,
  anUnconfiguredWindowShowsTheDashAndTheReason,
  aFailedOrganizationViewsReadLeavesTheTiles,
  bothViewsAreFetchedWithTheSameQuery,
  noViewIsFetchedWithoutAnOrganization,
  resetRecordedCharts,
  sourceStacksTheThreeSources,
  thePeakTimeIsFormattedInTheViewsZone,
  theLoadProfileStacksBySiteByDefault,
  theOnlyOrganizationIsPreselectedAndFetched,
  theOrganizationSectionsRender,
  theOrganizationSectionsWaitWhileOnlyTheViewIsNew,
  theRollupTileNamesLevelBucketAndZone,
  theTotalTileShowsTheChangeAgainstThePreviousPeriod,
} from "./energy-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
beforeEach(() => {
  resetRecordedCharts();
});
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

  it("does not call a missing previous power factor zero", async () => {
    await aMissingPreviousPowerFactorIsNotCalledZero();
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

describe("F4.299 the organization views on the Energy page", () => {
  it("fetches both views with the same query", async () => {
    await bothViewsAreFetchedWithTheSameQuery();
  });

  it("stacks the load profile by site by default", async () => {
    await theLoadProfileStacksBySiteByDefault();
  });

  it("re-stacks the load profile into the three sources", async () => {
    await sourceStacksTheThreeSources();
  });

  it("renders the ranking, the heatmap and the abnormal list", async () => {
    await theOrganizationSectionsRender();
  });

  it("holds the organization sections while only the view has the new filter", async () => {
    await theOrganizationSectionsWaitWhileOnlyTheViewIsNew();
  });

  it("keeps the KPI tiles when the organization views fail", async () => {
    await aFailedOrganizationViewsReadLeavesTheTiles();
  });
});

describe("F4.303 the Energy page's state in the URL", () => {
  it("P1: sends a full link as the first query, exactly", async () => {
    await aFullLinkIsTheFirstQuery();
  });

  it("P1: presses the link's stack and sort", async () => {
    await aFullLinkPressesItsStackAndSort();
  });

  it("P2: never sends an organization the reader cannot open, and says so", async () => {
    await aForeignOrganizationIsNeverSent();
  });

  it("P2: never sends a site the reader cannot open", async () => {
    await aForeignSiteIsNeverSent();
  });

  it("P2: Use my default filter clears the search and sends the default query", async () => {
    await useMyDefaultFilterClearsTheLink();
  });

  it("P3: writes a filter change to the URL", async () => {
    await aFilterChangeIsWrittenToTheUrl();
  });

  it("P3: writes the stack choice to the URL", async () => {
    await theStackChoiceIsWrittenToTheUrl();
  });

  it("P3: writes an empty search for the default filter", async () => {
    await theDefaultFilterWritesAnEmptySearch();
  });

  it("P4: ends the filter bar with Copy link", async () => {
    await copyLinkEndsTheFilterBar();
  });
});
