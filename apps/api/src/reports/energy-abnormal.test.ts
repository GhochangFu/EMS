// A host-zone leak (a `.getHours()` on an instant) would pass on a UTC or an
// Asia/Kolkata host. America/St_Johns is UTC-3:30 with DST, a half-hour offset
// no fixture zone shares (the `report-period.test.ts` pin and its reasoning).
process.env.TZ = "America/St_Johns";

import { describe, it } from "vitest";

import {
  assertAThinWindowDoesNotCount,
  assertAZeroBaselineIsNotEnoughHistory,
  assertAnAbsentWindowDoesNotCount,
  assertEntriesJudgeEveryEntityWithACurrentRow,
  assertHorizonDropsByTheWindowStart,
  assertHorizonKeepsEverythingAtOneHour,
  assertMedianOfEvenCount,
  assertMedianOfNothingIsNull,
  assertMedianOfOddCount,
  assertOrderAboveThenNotEnoughHistoryNormalCounted,
  assertRatioBelowOnePointFiveIsNormal,
  assertRatioOfOnePointFiveIsAbove,
  assertShiftKeepsTheSubMinuteRemainder,
  assertStepDaysByRange,
  assertThisMonthOfFifteenDaysSixHoursStepsSixteen,
  assertTodayWindowsInKolkata,
  assertTruncatedAtOneHundredAndOne,
  assertTwoCountingWindowsAreNotEnoughHistory,
  assertWindowsHoldTheWallClockAcrossFallBack,
} from "./energy-abnormal.spec";

/** `F4.299` U2 — Vitest entry point for the abnormal arithmetic. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.299 — the abnormal list's arithmetic (ADR 0108 Amendment 1, 7.7)", () => {
  describe("baseline windows", () => {
    it("a local-day shift keeps the seconds and milliseconds", () => assertShiftKeepsTheSubMinuteRemainder());
    it("today in Asia/Kolkata gives four 10.5 h windows on the preceding days", () => assertTodayWindowsInKolkata());
    it("7d steps 7 days and 30d steps 30", () => assertStepDaysByRange());
    it("a 15 d 6 h month-to-date steps 16 days", () => assertThisMonthOfFifteenDaysSixHoursStepsSixteen());
    it("a window across the New York fall-back holds the wall clock", () =>
      assertWindowsHoldTheWallClockAcrossFallBack());
  });

  describe("the retention horizon", () => {
    it("at 5m a window starting 736 d back is dropped, 734 d kept", () => assertHorizonDropsByTheWindowStart());
    it("at 1h every window is kept", () => assertHorizonKeepsEverythingAtOneHour());
  });

  describe("the median", () => {
    it("of [3, 1, 2] is 2", () => assertMedianOfOddCount());
    it("of [1, 2, 3, 4] is 2.5", () => assertMedianOfEvenCount());
    it("of nothing is null", () => assertMedianOfNothingIsNull());
  });

  describe("the verdict", () => {
    it("two counting windows are not enough history", () => assertTwoCountingWindowsAreNotEnoughHistory());
    it("a ratio of 1.5 is above", () => assertRatioOfOnePointFiveIsAbove());
    it("a ratio of 1.49 is normal", () => assertRatioBelowOnePointFiveIsNormal());
    it("a window under half the current bucket count does not count", () => assertAThinWindowDoesNotCount());
    it("a zero baseline is not enough history and never divides", () => assertAZeroBaselineIsNotEnoughHistory());
  });

  describe("the entries", () => {
    it("every entity with a current row is judged, and no other", () => assertEntriesJudgeEveryEntityWithACurrentRow());
    it("a window absent from the rows does not count", () => assertAnAbsentWindowDoesNotCount());
    it("above by ratio, then not enough history by name; normal counted, not sent", () =>
      assertOrderAboveThenNotEnoughHistoryNormalCounted());
    it("101 entries are cut to 100 with truncated", () => assertTruncatedAtOneHundredAndOne());
  });
});
