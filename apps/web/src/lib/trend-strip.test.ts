import { describe, it } from "vitest";

import {
  aColorsHitReturnsItsRole,
  aColorsMissReturnsAccent,
  aNullBreaksThePolyline,
  anAreaClosesEachRunToTheBottom,
  aNegativeBarHangsBelowZero,
  aZeroBarIsStillDrawn,
  barsStandOnTheZeroLine,
  pointStyleDefaultsToLine,
  aSelectionSearchCarriesSegmentsAndPoints,
  anEmptyListSendsNoKey,
  anotherSegmentsKeyReturnsAccent,
  noSelectionSearchIsTheF4305Bytes,
  undefinedColorsReturnAccent,
  aUtcZoneIsReportedAsUtc,
  allNullDrawsNothing,
  equalValuesDrawAFlatMidLine,
  historyHrefIsTheRenamedRoute,
  lastValueIsNullWhenNone,
  lastValueIsTheLastNonNull,
  theWindowLabelNames30MinBuckets,
  theWindowLabelNames3HourBuckets,
  xIsTheBucketPosition,
} from "./trend-strip.spec";

/** Vitest entry point (ADR 0014) — assertions live in `trend-strip.spec.ts`. */
describe("F4.301 trend strip helpers", () => {
  it("breaks the polyline at a null bucket", () => {
    aNullBreaksThePolyline();
  });

  it("places each point at its bucket position", () => {
    xIsTheBucketPosition();
  });

  it("draws equal values as a flat line at mid height", () => {
    equalValuesDrawAFlatMidLine();
  });

  it("draws nothing for an all-null series", () => {
    allNullDrawsNothing();
  });

  it("links to the renamed history route with range and point", () => {
    historyHrefIsTheRenamedRoute();
  });

  it("reads the last non-null value", () => {
    lastValueIsTheLastNonNull();
  });

  it("reads no last value when the series has none", () => {
    lastValueIsNullWhenNone();
  });

  it("names 30 min buckets and the zone in the window line", () => {
    theWindowLabelNames30MinBuckets();
  });

  it("names 3 hours buckets for the 7 d fold", () => {
    theWindowLabelNames3HourBuckets();
  });

  it("reports a stored UTC zone as UTC", () => {
    aUtcZoneIsReportedAsUtc();
  });
});

describe("F4.306 U9 trend strip selection helpers", () => {
  it("returns the colors entry's role for a hit", () => {
    aColorsHitReturnsItsRole();
  });

  it("returns accent for a point with no entry", () => {
    aColorsMissReturnsAccent();
  });

  it("returns accent with no colors", () => {
    undefinedColorsReturnAccent();
  });

  it("returns accent for the same code in another segment", () => {
    anotherSegmentsKeyReturnsAccent();
  });

  it("sends exactly range=24h with no selection", () => {
    noSelectionSearchIsTheF4305Bytes();
  });

  it("sends segments and points comma-joined", () => {
    aSelectionSearchCarriesSegmentsAndPoints();
  });

  it("sends no key for an empty list", () => {
    anEmptyListSendsNoKey();
  });
});

describe("F4.322 PR 3 — the area and bar sparkline styles (ADR 0108 Amendment 8)", () => {
  it("closes each area run to the bottom", () => anAreaClosesEachRunToTheBottom());
  it("stands each bar on the zero line", () => barsStandOnTheZeroLine());
  it("hangs a negative bar below zero and never hides the lowest", () => aNegativeBarHangsBelowZero());
  it("draws a zero reading as a 1 px bar", () => aZeroBarIsStillDrawn());
  it("defaults a point's style to line", () => pointStyleDefaultsToLine());
});
