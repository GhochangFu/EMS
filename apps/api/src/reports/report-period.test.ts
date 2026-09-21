// `E4.1b`'s trap: a `.getDay()` / `.getHours()` slip on a UTC-constructed
// Date reads the HOST zone, and on a UTC or Asia/Kolkata host every fixture
// below would still pass (measured: `new Date(Date.UTC(2026,8,21)).getDay()`
// is 1 on the host, 0 under this pin). America/St_Johns is UTC-3:30 with DST
// — a half-hour offset no fixture zone shares. ESM hoists the imports above
// this line, so the pin does not run "before the imports"; it works because
// Node re-reads `TZ` on assignment and every clock read in the module under
// test happens at call time, inside an `it()`, after this line has run.
process.env.TZ = "America/St_Johns";

import { describe, it } from "vitest";

import {
  assertNextRunAtRefusesUnknownZone,
  assertNextRunAtRow,
  assertParseRunAtLocalAcceptsSeconds,
  assertParseRunAtLocalRefusesNonZeroSeconds,
  assertParseRunAtLocalRefusesOneDigitHour,
  assertPeriodForRow,
  assertTimeZoneRow,
  assertToInstantRow,
  assertUtcOffsetRow,
  assertWeekdayOfMonday,
  NEXT_RUN_AT_ROWS,
  PERIOD_FOR_ROWS,
  TIME_ZONE_ROWS,
  TO_INSTANT_ROWS,
  UTC_OFFSET_ROWS,
} from "./report-period.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("report-period (F3.5b U3, ADR 0071 decision 7, plan R-6/R-7)", () => {
  describe("nextRunAt", () => {
    for (const row of NEXT_RUN_AT_ROWS) {
      it(row[0], () => {
        assertNextRunAtRow(row);
      });
    }
  });

  describe("toInstant", () => {
    for (const row of TO_INSTANT_ROWS) {
      it(row[0], () => {
        assertToInstantRow(row);
      });
    }
  });

  describe("periodFor", () => {
    for (const row of PERIOD_FOR_ROWS) {
      it(row[0], () => {
        assertPeriodForRow(row);
      });
    }
  });

  describe("utcOffsetMinutes", () => {
    for (const row of UTC_OFFSET_ROWS) {
      it(row[0], () => {
        assertUtcOffsetRow(row);
      });
    }
  });

  describe("isValidTimeZone", () => {
    for (const row of TIME_ZONE_ROWS) {
      it(row[0], () => {
        assertTimeZoneRow(row);
      });
    }
  });

  it("weekdayOf(2026-09-21) is 1 — Monday", () => {
    assertWeekdayOfMonday();
  });

  it('parseRunAtLocal("07:05:00") is { hour: 7, minute: 5 }', () => {
    assertParseRunAtLocalAcceptsSeconds();
  });

  it('parseRunAtLocal("07:05:30") throws ReportPeriodError — seconds must be 00', () => {
    assertParseRunAtLocalRefusesNonZeroSeconds();
  });

  it('parseRunAtLocal("7:05") throws ReportPeriodError — two-digit hour', () => {
    assertParseRunAtLocalRefusesOneDigitHour();
  });

  it("nextRunAt with an unknown zone throws with name ReportPeriodError", () => {
    assertNextRunAtRefusesUnknownZone();
  });
});
