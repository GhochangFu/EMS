import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  aMalformedPickerValueIsNull,
  aMissingInstantShowsAsAnEmptyInput,
  anInstantShowsInTheViewsZone,
  aPickerValueConvertsAcrossADstChange,
  aPickerValueConvertsInTheViewsZone,
  aPickerValueInAFoldResolvesToTheEarlierInstant,
  aPickerValueInAGapCarriesForward,
  changeHasNoPercentWhenAPowerFactorIsMissing,
  changeHasNoPercentWhenThePreviousFigureIsZero,
  changeIsNoneWhenTheCurrentPeriodHasNoData,
  changeIsNoneWithoutACompare,
  changeIsNoPreviousWhenTheComparePeriodHasNoData,
  changeIsThePercentAgainstThePreviousPeriod,
  changeOfAZeroCurrentFigureIsMinusOneHundred,
  changeReadsTheNamedFigure,
  defaultFilterHasNoOrganizationWhenNoneIsReadable,
  defaultFilterPreselectsTheFirstOrganization,
  levelLabelNamesTheLevelTheBucketAndTheZone,
  locationsOfOrganizationListsOnlyThatTree,
  partialNoteIsNullWhenTheCallerReadsEverySelectedSite,
  partialNoteNamesTheTwoCounts,
  queryOfACustomRangeCarriesBothInstantsTheSitesAndTheCompare,
  queryOfACustomRangeWithAMissingEndIsNull,
  queryOfAPresetOmitsTheInstantsAndEmptyKeys,
  queryWithoutAnOrganizationIsNull,
  theZoneLabelNamesTheZone,
} from "./energy-view-filter.spec";

/**
 * `F4.298` U5 — Vitest entry point; assertions live in the sibling `.spec`
 * (ADR 0014, §4.6). The browser zone is pinned to `America/St_Johns`, a zone
 * no fixture uses, so a conversion that read the browser's zone instead of the
 * view's would move every instant (ADR 0108 Status ruling c).
 */
describe("F4.298 energy view filter helpers", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "America/St_Johns");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("pins the browser zone away from every fixture zone", () => {
    // Midnight UTC in St John's (−2:30 in October) is 21:30 the day before.
    expect(new Date("2026-10-31T00:00:00.000Z").getHours()).toBe(21);
  });

  it("change: the percent against the previous period", () => {
    changeIsThePercentAgainstThePreviousPeriod();
  });

  it("change: none without a compare period", () => {
    changeIsNoneWithoutACompare();
  });

  it("change: no previous when the compare period has no data", () => {
    changeIsNoPreviousWhenTheComparePeriodHasNoData();
  });

  it("change: none when the current period has no data", () => {
    changeIsNoneWhenTheCurrentPeriodHasNoData();
  });

  it("change: no percent when the previous figure is zero", () => {
    changeHasNoPercentWhenThePreviousFigureIsZero();
  });

  it("change: a zero current figure is −100 %", () => {
    changeOfAZeroCurrentFigureIsMinusOneHundred();
  });

  it("change: no percent when a power factor is missing", () => {
    changeHasNoPercentWhenAPowerFactorIsMissing();
  });

  it("change: reads the named figure", () => {
    changeReadsTheNamedFigure();
  });

  it("levelLabel names the level, the bucket and the zone", () => {
    levelLabelNamesTheLevelTheBucketAndTheZone();
  });

  it("partialNote names the two counts", () => {
    partialNoteNamesTheTwoCounts();
  });

  it("partialNote is null when every selected site is readable", () => {
    partialNoteIsNullWhenTheCallerReadsEverySelectedSite();
  });

  it("defaultFilter preselects the first organization", () => {
    defaultFilterPreselectsTheFirstOrganization();
  });

  it("defaultFilter has no organization when none is readable", () => {
    defaultFilterHasNoOrganizationWhenNoneIsReadable();
  });

  it("locationsOfOrganization lists only that organization's tree", () => {
    locationsOfOrganizationListsOnlyThatTree();
  });

  it("query: a preset omits the instants and the empty keys", () => {
    queryOfAPresetOmitsTheInstantsAndEmptyKeys();
  });

  it("query: a custom range carries both instants, the sites and the compare", () => {
    queryOfACustomRangeCarriesBothInstantsTheSitesAndTheCompare();
  });

  it("query: a custom range with a missing end is null", () => {
    queryOfACustomRangeWithAMissingEndIsNull();
  });

  it("query: no organization is null", () => {
    queryWithoutAnOrganizationIsNull();
  });

  it("picker: a value converts in the view's zone", () => {
    aPickerValueConvertsInTheViewsZone();
  });

  it("picker: a value converts across a DST change", () => {
    aPickerValueConvertsAcrossADstChange();
  });

  it("picker: a fold resolves to the earlier instant", () => {
    aPickerValueInAFoldResolvesToTheEarlierInstant();
  });

  it("picker: a gap carries the wall clock forward", () => {
    aPickerValueInAGapCarriesForward();
  });

  it("picker: a malformed value is null", () => {
    aMalformedPickerValueIsNull();
  });

  it("picker: an instant shows in the view's zone", () => {
    anInstantShowsInTheViewsZone();
  });

  it("picker: a missing instant shows as an empty input", () => {
    aMissingInstantShowsAsAnEmptyInput();
  });

  it("the zone label names the zone", () => {
    theZoneLabelNamesTheZone();
  });
});
