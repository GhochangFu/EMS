import { describe, it } from "vitest";

import {
  aNullBreaksThePolyline,
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
