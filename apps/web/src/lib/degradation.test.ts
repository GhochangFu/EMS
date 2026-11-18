import { describe, it } from "vitest";

import {
  cardRowsKeepCrossingAssetsInOrderCappedWithNearest,
  healthCrossingIsTheCrossingHealthIndicator,
  noteForScheduleFindsItAcrossAssets,
  shownOfSaysShowingOnlyWhenCapped,
  theStaleTimeIsFifteenMinutes,
} from "./degradation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5b — degradation helpers", () => {
  it("the stale time is fifteen minutes", () => theStaleTimeIsFifteenMinutes());
  it("healthCrossingOf finds the crossing health indicator", () => healthCrossingIsTheCrossingHealthIndicator());
  it("cardRowsOf keeps crossing assets in order, capped, with the nearest indicator", () =>
    cardRowsKeepCrossingAssetsInOrderCappedWithNearest());
  it("shownOfSentence speaks only when capped", () => shownOfSaysShowingOnlyWhenCapped());
  it("noteForSchedule finds a note across assets", () => noteForScheduleFindsItAcrossAssets());
});
