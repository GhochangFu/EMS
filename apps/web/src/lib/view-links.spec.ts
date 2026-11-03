import { expect } from "vitest";

import type { EnergyFilterOptions } from "@bms/shared";

import { defaultFilter } from "./energy-view-filter";
import { ENERGY_VIEW } from "./site-trends";
import {
  type EnergyLink,
  type TrendsLink,
  defaultEnergyLink,
  energyFilterOfLink,
  energyLinkFromSearch,
  energyLinkOfFilter,
  energyLinkToSearch,
  trendsLinkFromSearch,
  trendsLinkToSearch,
} from "./view-links";

/**
 * `F4.303` U6 (ADR 0108 Amendment 6 item 2) — the view state in the URL: one parse rule for the
 * Energy page and the site Trends & Energy section. A value that does not parse is dropped and
 * the default applies, never a throw; the defaults write nothing. Entry point: `view-links.test.ts`.
 */

const ORG = "6f1d2a3b-0000-4000-8000-000000000001";
const OTHER_ORG = "6f1d2a3b-0000-4000-8000-000000000002";
const SITE_A = "6f1d2a3b-0000-4000-8000-0000000000a1";
const SITE_B = "6f1d2a3b-0000-4000-8000-0000000000b2";
const FROM = "2026-11-01T00:00:00.000Z";
const TO = "2026-11-02T06:30:00.000Z";

const FULL: EnergyLink = {
  organizationId: ORG,
  locationIds: [SITE_A, SITE_B],
  range: "custom",
  from: FROM,
  to: TO,
  compare: true,
  stackBy: "source",
  rankBy: "peakKw",
};

const OPTIONS: EnergyFilterOptions = {
  organizations: [
    { id: ORG, code: "ORG-A", name: "Organization A" },
    { id: OTHER_ORG, code: "ORG-B", name: "Organization B" },
  ],
  locations: [
    { id: SITE_A, name: "Site A", parentId: null, organizationId: ORG },
    { id: SITE_B, name: "Site B", parentId: null, organizationId: ORG },
  ],
};

function read(search: string): EnergyLink {
  return energyLinkFromSearch(new URLSearchParams(search));
}

/** L1: a full state with a custom range survives the URL. */
export function aFullCustomEnergyStateRoundTrips(): void {
  expect(energyLinkFromSearch(energyLinkToSearch(FULL))).toEqual(FULL);
}

/** L1: a full state with a preset survives the URL, written back to the same search. */
export function aFullPresetEnergyStateRoundTrips(): void {
  const search = `organizationId=${ORG}&locationIds=${SITE_A},${SITE_B}&range=7d&compare=1&stackBy=source&rankBy=kwhPerM2`;
  const link = read(search);
  expect(link).toEqual({
    organizationId: ORG,
    locationIds: [SITE_A, SITE_B],
    range: "7d",
    compare: true,
    stackBy: "source",
    rankBy: "kwhPerM2",
  });
  expect(energyLinkFromSearch(energyLinkToSearch(link))).toEqual(link);
}

/** L2: the defaults (`24h`, no compare, `stackBy=site`, `rankBy=kwh`, no locations) write nothing. */
export function theEnergyDefaultsWriteNothing(): void {
  expect(energyLinkToSearch(defaultEnergyLink()).toString()).toBe("");
  expect(energyLinkToSearch({ ...defaultEnergyLink(), range: "24h" }).toString()).toBe("");
}

/** L2, the read side: a bare search is the defaults. */
export function aBareSearchReadsTheEnergyDefaults(): void {
  expect(read("")).toEqual(defaultEnergyLink());
}

/** L3: a non-uuid id, an unknown range and an unknown sort fall away; the rest survives. */
export function unreadableEnergyValuesFallToTheDefault(): void {
  const link = read(`organizationId=not-a-uuid&locationIds=${SITE_A},nope&range=next_week&rankBy=cost&stackBy=source&compare=1`);
  expect(link).toEqual({ locationIds: [SITE_A], compare: true, stackBy: "source", rankBy: "kwh" });
}

/** L3: an instant that is not ISO drops the custom range; the other keys survive. */
export function aNonIsoInstantDropsTheCustomRange(): void {
  expect(read(`from=yesterday&to=${TO}&stackBy=source`)).toEqual({ ...defaultEnergyLink(), stackBy: "source" });
  expect(read(`from=2026-11-01&to=${TO}`)).toEqual(defaultEnergyLink());
}

/** L3: an unknown `stackBy` falls to `site`. */
export function anUnknownStackByFallsToSite(): void {
  expect(read("stackBy=asset&rankBy=peakKw")).toEqual({ ...defaultEnergyLink(), rankBy: "peakKw" });
}

/** L4: `from` without `to` is not a custom range. */
export function fromWithoutToIsNotCustom(): void {
  expect(read(`from=${FROM}`)).toEqual(defaultEnergyLink());
}

/** L7: a custom range writes `from` and `to` only, in the `toISOString()` form. */
export function aCustomRangeWritesIsoInstantsOnly(): void {
  const search = energyLinkToSearch({
    ...defaultEnergyLink(),
    range: "custom",
    from: "2026-11-01T05:30:00+05:30",
    to: "2026-11-02T00:00:00Z",
  });
  expect([...search]).toEqual([
    ["from", "2026-11-01T00:00:00.000Z"],
    ["to", "2026-11-02T00:00:00.000Z"],
  ]);
}

/**
 * A custom range with one end missing (a picker being cleared) keeps `range=custom` and the end
 * it has, so the pickers stay; a bare `range=custom` with neither end is the default.
 */
export function aHalfCustomRangeStaysCustom(): void {
  const search = energyLinkToSearch({ ...defaultEnergyLink(), range: "custom", to: TO });
  expect(search.toString()).toBe(new URLSearchParams({ range: "custom", to: TO }).toString());
  expect(energyLinkFromSearch(search)).toEqual({ ...defaultEnergyLink(), range: "custom", to: TO });
  expect(read("range=custom")).toEqual(defaultEnergyLink());
}

/** The link's filter: the listed organization and sites, the range and compare. */
export function aListedLinkIsTheFilter(): void {
  expect(energyFilterOfLink(FULL, OPTIONS)).toEqual({
    organizationId: ORG,
    locationIds: [SITE_A, SITE_B],
    range: "custom",
    from: FROM,
    to: TO,
    compare: "previous",
  });
  expect(energyFilterOfLink(defaultEnergyLink(), OPTIONS)).toEqual(defaultFilter(OPTIONS));
}

/** An organization the reader's options do not list is no filter. */
export function anUnlistedOrganizationIsNoFilter(): void {
  expect(energyFilterOfLink({ ...defaultEnergyLink(), organizationId: "6f1d2a3b-0000-4000-8000-0000000000ff" }, OPTIONS)).toBeNull();
}

/** A site the reader's options do not list is no filter. */
export function anUnlistedSiteIsNoFilter(): void {
  expect(
    energyFilterOfLink({ ...defaultEnergyLink(), locationIds: [SITE_A, "6f1d2a3b-0000-4000-8000-0000000000ff"] }, OPTIONS),
  ).toBeNull();
}

/** The default filter writes an empty search; any other state names its organization too. */
export function theDefaultFilterWritesNothingAndAnyOtherNamesTheOrganization(): void {
  const base = defaultFilter(OPTIONS);
  expect(energyLinkToSearch(energyLinkOfFilter(base, OPTIONS, "site", "kwh")).toString()).toBe("");
  expect(energyLinkToSearch(energyLinkOfFilter({ ...base, range: "7d" }, OPTIONS, "site", "kwh")).toString()).toBe(
    `organizationId=${ORG}&range=7d`,
  );
  expect(energyLinkToSearch(energyLinkOfFilter(base, OPTIONS, "source", "kwh")).toString()).toBe(
    `organizationId=${ORG}&stackBy=source`,
  );
  expect(energyLinkToSearch(energyLinkOfFilter({ ...base, organizationId: OTHER_ORG }, OPTIONS, "site", "kwh")).toString()).toBe(
    `organizationId=${OTHER_ORG}`,
  );
}

function trends(search: string): TrendsLink {
  return trendsLinkFromSearch(new URLSearchParams(search.replace(/^\?/, "")));
}

/** L5: a segment sub-tab with a custom range, compare and a sort survives the URL. */
export function aFullTrendsStateRoundTrips(): void {
  const link: TrendsLink = {
    view: "chillers",
    point: "kw",
    value: { range: "custom", from: FROM, to: TO, compare: "previous" },
    rankBy: "peakKw",
  };
  expect(trends(trendsLinkToSearch(link))).toEqual(link);
}

/** L5: a preset range round-trips, and its search is the view, the point, the range, compare and sort. */
export function aPresetTrendsStateRoundTrips(): void {
  const link: TrendsLink = { view: "chillers", point: "kw", value: { range: "7d", compare: "previous" }, rankBy: "kwhPerM2" };
  expect(trendsLinkToSearch(link)).toBe("?view=chillers&point=kw&range=7d&compare=1&rankBy=kwhPerM2");
  expect(trends(trendsLinkToSearch(link))).toEqual(link);
}

/** The bare section is the Energy sub-tab over the last 24 h, sorted by kWh; it writes nothing. */
export function theTrendsDefaultsWriteNothing(): void {
  expect(trends("")).toEqual({ view: ENERGY_VIEW, value: { range: "24h" }, rankBy: "kwh" });
  expect(trendsLinkToSearch({ view: ENERGY_VIEW, value: { range: "24h" }, rankBy: "kwh" })).toBe("");
}

/** L6: the Energy sub-tab writes no `view` and no `point`. */
export function theEnergySubTabWritesNoView(): void {
  expect(trendsLinkToSearch({ view: ENERGY_VIEW, point: "kw", value: { range: "7d" }, rankBy: "kwh" })).toBe("?range=7d");
}

/** The sub-tab search holds ids and codes only (the claim `trendsSearch` carried). */
export function aSegmentSubTabWritesItsViewAndPoint(): void {
  expect(trendsLinkToSearch({ view: "chillers", value: { range: "24h" }, rankBy: "kwh" })).toBe("?view=chillers");
  expect(trendsLinkToSearch({ view: "chillers", point: "kw", value: { range: "24h" }, rankBy: "kwh" })).toBe(
    "?view=chillers&point=kw",
  );
}

/** L3 for the section: an unknown range, a bad instant and an unknown sort fall to the default. */
export function unreadableTrendsValuesFallToTheDefault(): void {
  expect(trends("view=chillers&range=next_week&rankBy=cost&compare=1")).toEqual({
    view: "chillers",
    value: { range: "24h", compare: "previous" },
    rankBy: "kwh",
  });
  expect(trends(`from=yesterday&to=${TO}`).value).toEqual({ range: "24h" });
}

/** L7 for the section: a custom range writes `from` and `to` in the `toISOString()` form, no `range`. */
export function aTrendsCustomRangeWritesIsoInstantsOnly(): void {
  const search = trendsLinkToSearch({
    view: ENERGY_VIEW,
    value: { range: "custom", from: "2026-11-01T05:30:00+05:30", to: "2026-11-02T00:00:00Z" },
    rankBy: "kwh",
  });
  expect([...new URLSearchParams(search.slice(1))]).toEqual([
    ["from", "2026-11-01T00:00:00.000Z"],
    ["to", "2026-11-02T00:00:00.000Z"],
  ]);
}
