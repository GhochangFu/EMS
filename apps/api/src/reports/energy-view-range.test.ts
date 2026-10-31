// The `report-period.test.ts` pin: America/St_Johns is UTC-3:30 with DST, a
// half-hour offset no fixture zone shares, so a `.getHours()` / `.getDate()`
// slip that reads the host zone cannot pass by accident. Every clock read in
// the module under test happens at call time, inside an `it()`.
process.env.TZ = "America/St_Johns";

import { describe, it } from "vitest";

import {
  assertACoarsenedLevelBecomesTheBucket,
  assertADayBucketReadsTheHourlyLevel,
  assertAFineBucketReadsItsOwnLevelInsideRetention,
  assertAnInvalidLocationZoneFallsToTheOrganization,
  assertCustomAcceptsAnOffsetInstant,
  assertCustomFromNotBeforeToIsA400,
  assertCustomOf365DaysPasses,
  assertCustomOver365DaysIsA400,
  assertCustomWithoutFromIsA400,
  assertCustomWithoutToIsA400,
  assertDisplayBucketRow,
  assertPreviousPeriodEndsOneMillisecondBeforeTheStart,
  assertStoredUtcResolvesThroughEtcUtc,
  assertThisMonthAcrossTheNewYorkDstChange,
  assertTodayStartsAtLocalMidnightInKolkata,
  assertTrailingPresetsEndAtNow,
  DISPLAY_BUCKET_ROWS,
} from "./energy-view-range.spec";

describe("energy view range (F4.298 U2, ADR 0108 decision 2.8)", () => {
  it("today starts at local midnight in Asia/Kolkata and ends at now", assertTodayStartsAtLocalMidnightInKolkata);
  it("this month in America/New_York starts at 00:00 EDT and counts the DST hour once", assertThisMonthAcrossTheNewYorkDstChange);
  it("a stored UTC computes on Etc/UTC and reports UTC", assertStoredUtcResolvesThroughEtcUtc);
  it("an invalid location zone falls to the organization's", assertAnInvalidLocationZoneFallsToTheOrganization);
  it("24h, 7d, 30d and 1y trail from now", assertTrailingPresetsEndAtNow);
});

describe("energy view compare period (F4.298 U2, ADR 0108 decision 2.2)", () => {
  it("the previous period is [s - len, s) with an inclusive end of s - 1 ms", assertPreviousPeriodEndsOneMillisecondBeforeTheStart);
});

describe("energy view custom range (F4.298 U2, ADR 0108 decision 2.2)", () => {
  it("a custom range without from is a 400", assertCustomWithoutFromIsA400);
  it("a custom range without to is a 400", assertCustomWithoutToIsA400);
  it("a custom range with from >= to is a 400", assertCustomFromNotBeforeToIsA400);
  it("a custom range of 366 days is a 400", assertCustomOver365DaysIsA400);
  it("a custom range of 365 days passes", assertCustomOf365DaysPasses);
  it("a custom range accepts an offset instant", assertCustomAcceptsAnOffsetInstant);
});

describe("energy view display bucket (F4.298 U2, ADR 0108 decision 2.4)", () => {
  for (const [label, hours, bucket] of DISPLAY_BUCKET_ROWS) {
    it(`${label} -> ${bucket}`, () => assertDisplayBucketRow(hours, bucket));
  }
});

describe("energy view read level (F4.298 U2, ADR 0108 decision 2.4)", () => {
  it("a 1d bucket reads the 1h level", assertADayBucketReadsTheHourlyLevel);
  it("a 5m bucket inside retention reads 5m", assertAFineBucketReadsItsOwnLevelInsideRetention);
  it("a level coarsened past the bucket becomes the bucket", assertACoarsenedLevelBecomesTheBucket);
});
