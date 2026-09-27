import { describe, it } from "vitest";

import {
  assertADayAndOneMinuteIsNotEmpty,
  assertAFarFutureRowStillRefreshesTheDayLevel,
  assertAFutureRowSkipsOnlyTheEmptyMinuteLevel,
  assertAMisalignedWindowCanBeEmptyEvenWhenWiderThanABucket,
  assertAnHourLevelWindowAtTheBoundaryIsNotEmpty,
  assertAnHourLevelWindowShortOfTheBoundaryIsEmpty,
  assertAPastRowRefreshesEveryLevel,
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

describe("F4.166 — refreshAggregatesFrom skips a level whose window holds no complete bucket", () => {
  it("skips only the 1-minute level for a row 60 s ahead of the clock", async () => {
    await assertAFutureRowSkipsOnlyTheEmptyMinuteLevel();
  });

  it("still refreshes the 1-day level for a row an hour ahead, after three empty levels", async () => {
    await assertAFarFutureRowStillRefreshesTheDayLevel();
  });

  it("refreshes all four levels for a row in the past", async () => {
    await assertAPastRowRefreshesEveryLevel();
  });
});
