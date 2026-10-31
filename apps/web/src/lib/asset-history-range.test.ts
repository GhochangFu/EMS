import { afterAll, beforeAll, describe, it, vi } from "vitest";

import {
  aCustomQueryCarriesBothInstants,
  aLocalInputIsReadInTheSiteZone,
  aPresetQueryIsATrailingWindow,
  aThirdUnitIsRefused,
  anUnknownOrHalfRangeFallsBackTo24h,
  pointsAreCappedAtTheWidgetLimit,
  pointsAreDeduplicated,
  shiftCompareBucketsMovesByExactlyTheSpan,
  thePresetsAreTheFivePlanned,
  theRangeRoundTripsThroughTheUrl,
} from "./asset-history-range.spec";

/** Vitest entry point (ADR 0014). `TZ` is pinned to a zone no fixture uses. */
describe("F4.297 asset history range", () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "America/St_Johns");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("round trips the range through the URL", () => {
    theRangeRoundTripsThroughTheUrl();
  });
  it("offers the five presets", () => {
    thePresetsAreTheFivePlanned();
  });
  it("asks a preset as a trailing window", () => {
    aPresetQueryIsATrailingWindow();
  });
  it("asks a custom range as from and to", () => {
    aCustomQueryCarriesBothInstants();
  });
  it("falls back to 24 h for an unknown or half range", () => {
    anUnknownOrHalfRangeFallsBackTo24h();
  });
  it("caps points at the widget limit", () => {
    pointsAreCappedAtTheWidgetLimit();
  });
  it("lists a repeated point once", () => {
    pointsAreDeduplicated();
  });
  it("shifts compare buckets by exactly the span", () => {
    shiftCompareBucketsMovesByExactlyTheSpan();
  });
  it("refuses a third unit", () => {
    aThirdUnitIsRefused();
  });
  it("reads the picker in the site zone", () => {
    aLocalInputIsReadInTheSiteZone();
  });
});
