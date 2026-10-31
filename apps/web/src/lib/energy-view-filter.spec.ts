import { expect } from "vitest";

import type { EnergyFilterOptions, EnergyViewPeriod } from "@bms/shared";

import {
  changeFor,
  defaultFilter,
  energyViewQueryOf,
  instantToZoneInput,
  levelLabel,
  locationsOfOrganization,
  partialNote,
  zoneInputToInstant,
  zoneLabel,
} from "./energy-view-filter";

/**
 * `F4.298` U5 (ADR 0108 decision 2) — the Energy page's pure filter helpers.
 *
 * The custom picker works in the **view's** zone (ADR 0108 Status ruling c):
 * the zone the `energy/view` response returns, never the browser's. The
 * `.test.ts` wrapper pins `TZ=America/St_Johns` (a half-hour, DST zone that no
 * fixture below uses), so a helper that fell back to the browser's local time
 * would produce a different instant and redden its own assertion.
 */

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function period(overrides: Partial<EnergyViewPeriod> = {}): EnergyViewPeriod {
  return {
    from: "2026-10-30T00:00:00.000Z",
    to: "2026-10-30T23:59:59.999Z",
    durationHours: 24,
    hasData: true,
    totalKwh: 100,
    peakKw: 40,
    peakAt: "2026-10-30T12:00:00.000Z",
    avgPf: 0.9,
    pueEstimate: null,
    indicativeCost: null,
    tariffPerKwh: null,
    currency: null,
    sourceTotals: { gridKwh: 100, solarKwh: 0, dgKwh: 0 },
    series: [],
    ...overrides,
  };
}

function options(organizationIds: readonly string[]): EnergyFilterOptions {
  return {
    organizations: organizationIds.map((id, index) => ({ id, code: `ORG${index}`, name: `Organization ${index}` })),
    locations: [
      { id: "loc-a1", name: "A one", parentId: null, organizationId: ORG_A },
      { id: "loc-a2", name: "A two", parentId: "loc-a1", organizationId: ORG_A },
      { id: "loc-b1", name: "B one", parentId: null, organizationId: ORG_B },
    ],
  };
}

export function changeIsThePercentAgainstThePreviousPeriod(): void {
  expect(changeFor(period({ totalKwh: 112.5 }), period({ totalKwh: 100 }), "totalKwh")).toEqual({ kind: "change", pct: 12.5 });
}

export function changeIsNoneWithoutACompare(): void {
  expect(changeFor(period(), null, "totalKwh")).toEqual({ kind: "none" });
}

export function changeIsNoPreviousWhenTheComparePeriodHasNoData(): void {
  expect(changeFor(period(), period({ hasData: false, totalKwh: 0 }), "totalKwh")).toEqual({ kind: "no_previous" });
}

/** The current period without data has no change to show either (decision 2.6: both periods need data). */
export function changeIsNoneWhenTheCurrentPeriodHasNoData(): void {
  expect(changeFor(period({ hasData: false, totalKwh: 0 }), period(), "totalKwh")).toEqual({ kind: "none" });
}

/** A zero previous figure is the divisor: no percent, and never `Infinity` or `NaN`. */
export function changeHasNoPercentWhenThePreviousFigureIsZero(): void {
  expect(changeFor(period({ totalKwh: 50 }), period({ totalKwh: 0 }), "totalKwh")).toEqual({ kind: "change", pct: null });
}

/** A zero current figure with data is a real −100 %, not a missing one. */
export function changeOfAZeroCurrentFigureIsMinusOneHundred(): void {
  expect(changeFor(period({ totalKwh: 0 }), period({ totalKwh: 100 }), "totalKwh")).toEqual({ kind: "change", pct: -100 });
}

export function changeHasNoPercentWhenAPowerFactorIsMissing(): void {
  expect(changeFor(period({ avgPf: null }), period({ avgPf: 0.9 }), "avgPf")).toEqual({ kind: "change", pct: null });
  expect(changeFor(period({ avgPf: 0.9 }), period({ avgPf: null }), "avgPf")).toEqual({ kind: "change", pct: null });
}

export function changeReadsTheNamedFigure(): void {
  expect(changeFor(period({ peakKw: 30, totalKwh: 100 }), period({ peakKw: 40, totalKwh: 100 }), "peakKw")).toEqual({ kind: "change", pct: -25 });
}

export function levelLabelNamesTheLevelTheBucketAndTheZone(): void {
  expect(levelLabel("1h", "1d", "Asia/Kolkata")).toBe("1h rollup · 1 day buckets · Asia/Kolkata");
  expect(levelLabel("1m", "1m", "UTC")).toBe("1m rollup · 1 minute buckets · UTC");
  expect(levelLabel("5m", "5m", "Europe/London")).toBe("5m rollup · 5 minute buckets · Europe/London");
  expect(levelLabel("1h", "1h", "UTC")).toBe("1h rollup · 1 hour buckets · UTC");
}

export function partialNoteNamesTheTwoCounts(): void {
  expect(partialNote({ readableSites: 2, selectedSites: 3 })).toBe("partial — your access covers 2 of 3 sites");
}

export function partialNoteIsNullWhenTheCallerReadsEverySelectedSite(): void {
  expect(partialNote({ readableSites: 3, selectedSites: 3 })).toBeNull();
  expect(partialNote(null)).toBeNull();
}

/** Owner answer Q3: the page preselects the first organization. */
export function defaultFilterPreselectsTheFirstOrganization(): void {
  expect(defaultFilter(options([ORG_A]))).toEqual({ organizationId: ORG_A, locationIds: [], range: "24h" });
  expect(defaultFilter(options([ORG_B, ORG_A])).organizationId).toBe(ORG_B);
}

export function defaultFilterHasNoOrganizationWhenNoneIsReadable(): void {
  expect(defaultFilter(options([])).organizationId).toBe("");
}

export function locationsOfOrganizationListsOnlyThatTree(): void {
  expect(locationsOfOrganization(options([ORG_A, ORG_B]), ORG_A).map((l) => l.id)).toEqual(["loc-a1", "loc-a2"]);
  expect(locationsOfOrganization(options([ORG_A, ORG_B]), "")).toEqual([]);
}

export function queryOfAPresetOmitsTheInstantsAndEmptyKeys(): void {
  expect(
    energyViewQueryOf({ organizationId: ORG_A, locationIds: [], range: "7d", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" }),
  ).toEqual({ range: "7d", organizationId: ORG_A });
}

export function queryOfACustomRangeCarriesBothInstantsTheSitesAndTheCompare(): void {
  expect(
    energyViewQueryOf({
      organizationId: ORG_A,
      locationIds: ["loc-a1"],
      range: "custom",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      compare: "previous",
    }),
  ).toEqual({
    range: "custom",
    organizationId: ORG_A,
    locationIds: ["loc-a1"],
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
    compare: "previous",
  });
}

/** A custom range with a missing end is not sent: the service would answer 400. */
export function queryOfACustomRangeWithAMissingEndIsNull(): void {
  expect(energyViewQueryOf({ organizationId: ORG_A, locationIds: [], range: "custom", from: "2026-10-01T00:00:00.000Z" })).toBeNull();
  expect(energyViewQueryOf({ organizationId: ORG_A, locationIds: [], range: "custom", to: "2026-10-01T00:00:00.000Z" })).toBeNull();
}

/** Without an organization there is nothing to ask for (owner answer Q3: no fleet-wide view). */
export function queryWithoutAnOrganizationIsNull(): void {
  expect(energyViewQueryOf({ organizationId: "", locationIds: [], range: "24h" })).toBeNull();
}

/** India has no DST and a half-hour offset: local midnight is 18:30Z the day before. */
export function aPickerValueConvertsInTheViewsZone(): void {
  expect(zoneInputToInstant("2026-10-31T00:00", "Asia/Kolkata")).toBe("2026-10-30T18:30:00.000Z");
  expect(zoneInputToInstant("2026-10-31T00:00", "UTC")).toBe("2026-10-31T00:00:00.000Z");
}

/** New York in summer is EDT (−4 h), in winter EST (−5 h): the offset follows the date, not the browser. */
export function aPickerValueConvertsAcrossADstChange(): void {
  expect(zoneInputToInstant("2026-07-01T12:00", "America/New_York")).toBe("2026-07-01T16:00:00.000Z");
  expect(zoneInputToInstant("2026-12-01T12:00", "America/New_York")).toBe("2026-12-01T17:00:00.000Z");
}

/** A fold (01:30 on the fall-back night) resolves to the earlier occurrence, the `report-period.ts` rule. */
export function aPickerValueInAFoldResolvesToTheEarlierInstant(): void {
  expect(zoneInputToInstant("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
}

/** A gap (02:30 on the spring-forward night) carries the wall clock forward by the gap's width. */
export function aPickerValueInAGapCarriesForward(): void {
  expect(zoneInputToInstant("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
}

export function aMalformedPickerValueIsNull(): void {
  expect(zoneInputToInstant("", "Asia/Kolkata")).toBeNull();
  expect(zoneInputToInstant("2026-10-31", "Asia/Kolkata")).toBeNull();
}

export function anInstantShowsInTheViewsZone(): void {
  expect(instantToZoneInput("2026-10-30T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-10-31T00:00");
  expect(instantToZoneInput("2026-11-01T05:30:00.000Z", "America/New_York")).toBe("2026-11-01T01:30");
  expect(instantToZoneInput("2026-11-01T06:30:00.000Z", "America/New_York")).toBe("2026-11-01T01:30");
  expect(instantToZoneInput("2026-10-31T00:00:00.000Z", "UTC")).toBe("2026-10-31T00:00");
}

export function aMissingInstantShowsAsAnEmptyInput(): void {
  expect(instantToZoneInput(undefined, "Asia/Kolkata")).toBe("");
  expect(instantToZoneInput("not a date", "Asia/Kolkata")).toBe("");
}

export function theZoneLabelNamesTheZone(): void {
  expect(zoneLabel("Asia/Kolkata")).toBe("Times in Asia/Kolkata");
}
