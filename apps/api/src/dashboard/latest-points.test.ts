import { describe, it } from "vitest";

import {
  assertBadDayThrows,
  assertManyDaysMergeIntoTheLastArm,
  assertNextDayRollsCalendarBoundaries,
  assertNoPairsStillNamesEveryParameter,
  assertTwoDaysMakeTwoLiteralBoundedArms,
} from "./latest-points.spec";

/**
 * `F4.390` — Vitest wrapper for the pure Assets tab latest-read builder. Assertions live in the
 * sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.390 — planLatestPoints", () => {
  it("makes one day-literal-bounded arm per day, newest first", () => {
    assertTwoDaysMakeTwoLiteralBoundedArms();
  });

  it("merges every day past the fifth into the last arm", () => {
    assertManyDaysMergeIntoTheLastArm();
  });

  it("rolls the next day across month, year and leap February", () => {
    assertNextDayRollsCalendarBoundaries();
  });

  it("still names every parameter when there are no pairs", () => {
    assertNoPairsStillNamesEveryParameter();
  });

  it("throws on a day that is not a real YYYY-MM-DD date", () => {
    assertBadDayThrows();
  });
});
