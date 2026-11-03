import { describe, it } from "vitest";

import {
  aBareSearchReadsTheEnergyDefaults,
  aCustomRangeWritesIsoInstantsOnly,
  aFullCustomEnergyStateRoundTrips,
  aFullPresetEnergyStateRoundTrips,
  aFullTrendsStateRoundTrips,
  aHalfCustomRangeStaysCustom,
  aListedLinkIsTheFilter,
  aNonIsoInstantDropsTheCustomRange,
  aPresetTrendsStateRoundTrips,
  aSegmentSubTabWritesItsViewAndPoint,
  aTrendsCustomRangeWritesIsoInstantsOnly,
  anUnknownStackByFallsToSite,
  anUnlistedOrganizationIsNoFilter,
  anUnlistedSiteIsNoFilter,
  fromWithoutToIsNotCustom,
  theDefaultFilterWritesNothingAndAnyOtherNamesTheOrganization,
  theEnergyDefaultsWriteNothing,
  theEnergySubTabWritesNoView,
  theTrendsDefaultsWriteNothing,
  unreadableEnergyValuesFallToTheDefault,
  unreadableTrendsValuesFallToTheDefault,
} from "./view-links.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.303 view links: the Energy page's state in the URL", () => {
  it("L1: round-trips a full state with a custom range", () => {
    aFullCustomEnergyStateRoundTrips();
  });
  it("L1: round-trips a full state with a preset range", () => {
    aFullPresetEnergyStateRoundTrips();
  });
  it("L2: writes nothing at the defaults", () => {
    theEnergyDefaultsWriteNothing();
  });
  it("L2: reads a bare search as the defaults", () => {
    aBareSearchReadsTheEnergyDefaults();
  });
  it("L3: drops a non-uuid id, an unknown range and an unknown sort, keeping the rest", () => {
    unreadableEnergyValuesFallToTheDefault();
  });
  it("L3: drops a custom range whose instant is not ISO", () => {
    aNonIsoInstantDropsTheCustomRange();
  });
  it("L3: reads an unknown stackBy as site", () => {
    anUnknownStackByFallsToSite();
  });
  it("L4: does not read from without to as custom", () => {
    fromWithoutToIsNotCustom();
  });
  it("L7: writes a custom range as from and to in the toISOString form", () => {
    aCustomRangeWritesIsoInstantsOnly();
  });
  it("keeps a half-entered custom range custom", () => {
    aHalfCustomRangeStaysCustom();
  });
  it("turns a listed link into the filter", () => {
    aListedLinkIsTheFilter();
  });
  it("gives no filter for an organization the options do not list", () => {
    anUnlistedOrganizationIsNoFilter();
  });
  it("gives no filter for a site the options do not list", () => {
    anUnlistedSiteIsNoFilter();
  });
  it("writes an empty search for the default filter and names the organization otherwise", () => {
    theDefaultFilterWritesNothingAndAnyOtherNamesTheOrganization();
  });
});

describe("F4.303 view links: the Trends & Energy section's state in the URL", () => {
  it("L5: round-trips a segment sub-tab with a custom range, compare and a sort", () => {
    aFullTrendsStateRoundTrips();
  });
  it("L5: round-trips a preset range", () => {
    aPresetTrendsStateRoundTrips();
  });
  it("writes nothing at the defaults", () => {
    theTrendsDefaultsWriteNothing();
  });
  it("L6: writes no view for the Energy sub-tab", () => {
    theEnergySubTabWritesNoView();
  });
  it("writes the segment sub-tab's view and point", () => {
    aSegmentSubTabWritesItsViewAndPoint();
  });
  it("L3: drops an unknown range, a bad instant and an unknown sort", () => {
    unreadableTrendsValuesFallToTheDefault();
  });
  it("L7: writes a custom range as from and to in the toISOString form", () => {
    aTrendsCustomRangeWritesIsoInstantsOnly();
  });
});
