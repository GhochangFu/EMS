import { describe, it } from "vitest";

import {
  assertADayAndOneMinuteIsNotEmpty,
  assertAMisalignedWindowCanBeEmptyEvenWhenWiderThanABucket,
  assertAnHourLevelWindowAtTheBoundaryIsNotEmpty,
  assertAnHourLevelWindowShortOfTheBoundaryIsEmpty,
  assertTheCiInstantIsEmpty,
} from "./refresh-aggregates.spec";

describe("F4.71 — inscribedWindowIsEmpty", () => {
  it("calls the CI 03:01:41 instant empty at the 1-day level", () => {
    assertTheCiInstantIsEmpty();
  });

  it("calls a day-plus-a-minute window not empty at the 1-day level", () => {
    assertADayAndOneMinuteIsNotEmpty();
  });

  it("calls a misaligned 24h10m window empty even though it is wider than a bucket", () => {
    assertAMisalignedWindowCanBeEmptyEvenWhenWiderThanABucket();
  });

  it("calls a 1-hour-level window short of the boundary empty", () => {
    assertAnHourLevelWindowShortOfTheBoundaryIsEmpty();
  });

  it("calls a 1-hour-level window that reaches the boundary not empty", () => {
    assertAnHourLevelWindowAtTheBoundaryIsNotEmpty();
  });
});
