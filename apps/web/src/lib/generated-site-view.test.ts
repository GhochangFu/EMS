import { describe, it } from "vitest";

import {
  expandedShowsEveryPoint,
  headlineSliceKeepsServerOrder,
  newerReadingReplaces,
  noSampleIsNone,
  nullSeedTakesTheReading,
  nullValuePrintsTheDash,
  olderOrEqualReadingIsIgnored,
  sampleInsideTheWindowIsLive,
  samplePastTheWindowIsStale,
  undatableReadingIsIgnored,
  valuesRoundToTwoPlaces,
  zeroPrintsZero,
} from "./generated-site-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F3.68 generated site view — pure helpers", () => {
  it("L1a shows the first four points in server order", () => {
    headlineSliceKeepsServerOrder();
  });

  it("L1b shows every point when expanded", () => {
    expandedShowsEveryPoint();
  });

  it("L2a takes a newer reading", () => {
    newerReadingReplaces();
  });

  it("L2b ignores an older or equal reading", () => {
    olderOrEqualReadingIsIgnored();
  });

  it("L2c takes any reading over a null seed", () => {
    nullSeedTakesTheReading();
  });

  it("L2d ignores a reading it cannot date", () => {
    undatableReadingIsIgnored();
  });

  it("L3a reads none with no sample", () => {
    noSampleIsNone();
  });

  it("L3b reads live inside the shared window", () => {
    sampleInsideTheWindowIsLive();
  });

  it("L3c reads stale past the shared window", () => {
    samplePastTheWindowIsStale();
  });

  it("L4a prints the dash for null", () => {
    nullValuePrintsTheDash();
  });

  it("L4b prints zero as 0", () => {
    zeroPrintsZero();
  });

  it("L4c rounds to two places", () => {
    valuesRoundToTwoPlaces();
  });
});
