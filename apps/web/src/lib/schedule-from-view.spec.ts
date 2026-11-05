import { expect } from "vitest";

import type { SiteSegmentViewsDto } from "@bms/shared";

import { SEGMENT_VIEWS_BODY } from "../api/segment-views.spec";
import {
  energySchedulePrefill,
  historySchedulePrefill,
  scheduleTemplateLine,
  segmentSchedulePrefill,
} from "./schedule-from-view";

/**
 * `F4.303` U16 (ADR 0108 Amendment 6 item 6) — what a view hands the schedule wizard: the
 * template, the sites and the compare (Energy views, `energy_consumption`) or the points
 * (point views, `trend_points`). Pure. Entry point: `schedule-from-view.test.ts`.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE_A = "22222222-2222-4222-8222-22222222222a";
const SITE_B = "22222222-2222-4222-8222-22222222222b";
const ASSET = "33333333-3333-4333-8333-333333333331";
const ASSET_B = "33333333-3333-4333-8333-333333333332";
const ASSET_C = "33333333-3333-4333-8333-333333333333";

/** F1 — a whole-organization filter schedules the whole organization, without compare. */
export function aWholeOrganizationFilterHasNoLocations(): void {
  expect(energySchedulePrefill({ organizationId: ORG, locationIds: [] })).toEqual({
    templateId: "energy_consumption",
    params: { compare: false },
    locationIds: [],
    organizationId: ORG,
  });
}

/** F1 — compare on becomes `params.compare`. */
export function compareOnIsCarried(): void {
  const prefill = energySchedulePrefill({ organizationId: ORG, locationIds: [], compare: "previous" });
  expect(prefill.params).toEqual({ compare: true });
}

/** F1 — the filter's locations are the schedule's. */
export function theFiltersLocationsAreCarried(): void {
  const prefill = energySchedulePrefill({ organizationId: ORG, locationIds: [SITE_A, SITE_B] });
  expect(prefill.locationIds).toEqual([SITE_A, SITE_B]);
}

/** F1 — the site section has no organization in its state: none is invented. */
export function noOrganizationIsInvented(): void {
  const prefill = energySchedulePrefill({ locationIds: [SITE_A] });
  expect("organizationId" in prefill).toBe(false);
}

/** F2 — asset history: the template, the one location, one pair per chosen point, compare from the range. */
export function historyIsATrendPointsPrefill(): void {
  const prefill = historySchedulePrefill({ id: ASSET, locationId: SITE_A }, { compare: true }, ["kw", "pf"]);
  expect(prefill).toEqual({
    templateId: "trend_points",
    params: {
      points: [
        { assetId: ASSET, pointKey: "kw" },
        { assetId: ASSET, pointKey: "pf" },
      ],
      compare: true,
    },
    locationIds: [SITE_A],
  });
}

/** F2 — compare off stays off. */
export function historyCompareOffStaysOff(): void {
  const prefill = historySchedulePrefill({ id: ASSET, locationId: SITE_A }, { compare: false }, ["kw"]);
  expect(prefill.params).toMatchObject({ compare: false });
}

/** F2 — the contract's cap: no more than eight pairs reach the wizard. */
export function historyKeepsAtMostEightPoints(): void {
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const prefill = historySchedulePrefill({ id: ASSET, locationId: SITE_A }, { compare: false }, keys);
  expect(prefill.params !== null && "points" in prefill.params ? prefill.params.points.length : -1).toBe(8);
}

function entry(assetId: string, drawn: boolean): SiteSegmentViewsDto["ranking"][number] {
  const stats = { mean: 10, max: 12, maxAt: null, sampleCount: 5 };
  return {
    assetId,
    assetCode: assetId.slice(-1),
    assetName: assetId.slice(-1),
    assetRtuName: null,
    assetLocationName: null,
    unit: "kW",
    current: stats,
    compare: null,
    buckets: drawn ? [{ t: "2026-10-30T00:00:00.000Z", v: 10 }] : null,
    compareBuckets: null,
  };
}

const SEGMENT = {
  ...SEGMENT_VIEWS_BODY,
  ranking: [entry(ASSET, true), entry(ASSET_B, true), entry(ASSET_C, false)],
} as SiteSegmentViewsDto;

/** F3 — a segment sub-tab schedules its drawn pairs only, on the sub-tab's point, at the site. */
export function segmentIsTheDrawnPairsAtTheSite(): void {
  expect(segmentSchedulePrefill(SITE_A, SEGMENT, true)).toEqual({
    templateId: "trend_points",
    params: {
      points: [
        { assetId: ASSET, pointKey: "kw" },
        { assetId: ASSET_B, pointKey: "kw" },
      ],
      compare: true,
    },
    locationIds: [SITE_A],
  });
}

/** F3 — a sub-tab with no point has nothing to schedule: no prefill, so no button. */
export function aSegmentWithoutAPointHasNoPrefill(): void {
  expect(segmentSchedulePrefill(SITE_A, { ...SEGMENT, point: null }, false)).toBeNull();
}

/** F3 — a sub-tab whose series are all past the chart cap has nothing drawn to schedule either. */
export function aSegmentWithNothingDrawnHasNoPrefill(): void {
  const undrawn = { ...SEGMENT, ranking: [entry(ASSET_C, false)] } as SiteSegmentViewsDto;
  expect(segmentSchedulePrefill(SITE_A, undrawn, false)).toBeNull();
}

/** The wizard's read-only line, by arm. */
export function theTemplateLineNamesTheArm(): void {
  const trend = historySchedulePrefill({ id: ASSET, locationId: SITE_A }, { compare: false }, ["kw", "pf"]);
  const one = historySchedulePrefill({ id: ASSET, locationId: SITE_A }, { compare: false }, ["kw"]);
  const energyOn = energySchedulePrefill({ locationIds: [], compare: "previous" });
  const energyOff = energySchedulePrefill({ locationIds: [] });
  expect([
    scheduleTemplateLine(trend),
    scheduleTemplateLine(one),
    scheduleTemplateLine(energyOn),
    scheduleTemplateLine(energyOff),
  ]).toEqual([
    "Template: Trend points · 2 points",
    "Template: Trend points · 1 point",
    "Template: Energy consumption · compare on",
    "Template: Energy consumption",
  ]);
}
