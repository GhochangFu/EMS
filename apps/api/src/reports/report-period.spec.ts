import type { ReportCadence } from "@bms/shared";

import {
  isValidTimeZone,
  nextRunAt,
  parseRunAtLocal,
  periodFor,
  ReportPeriodError,
  toInstant,
  utcOffsetMinutes,
  weekdayOf,
} from "./report-period";

/**
 * `F3.5b` U3 — `report-period.ts` fixtures (plan R-7). Every row is a value
 * the plan pins, never a procedure re-derived here; the `.test.ts` wrapper
 * runs one `it()` per row with `process.env.TZ = "America/St_Johns"` so a
 * host-zone leak cannot pass by accident.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export type NextRunAtRow = readonly [
  label: string,
  input: { cadence: ReportCadence; runAtLocal: string; timezone: string; now: string },
  expectedIso: string,
];

/** `nextRunAt` rows — `[label, input, expected ISO instant]`. */
export const NEXT_RUN_AT_ROWS: readonly NextRunAtRow[] = [
  [
    "Asia/Kolkata daily 00:30 from 2026-09-21T10:00Z is 2026-09-21T19:00Z",
    { cadence: "daily", runAtLocal: "00:30", timezone: "Asia/Kolkata", now: "2026-09-21T10:00:00Z" },
    "2026-09-21T19:00:00.000Z",
  ],
  [
    "Asia/Kolkata daily 00:00 one second before due is 2026-09-21T18:30Z",
    { cadence: "daily", runAtLocal: "00:00", timezone: "Asia/Kolkata", now: "2026-09-21T18:29:59Z" },
    "2026-09-21T18:30:00.000Z",
  ],
  [
    "Asia/Kolkata daily 00:00 exactly due (now === the occurrence) is strictly after: 2026-09-22T18:30Z",
    { cadence: "daily", runAtLocal: "00:00", timezone: "Asia/Kolkata", now: "2026-09-21T18:30:00Z" },
    "2026-09-22T18:30:00.000Z",
  ],
  [
    "Europe/London daily 06:00 from 2026-03-27T12:00Z is 2026-03-28T06:00Z (GMT)",
    { cadence: "daily", runAtLocal: "06:00", timezone: "Europe/London", now: "2026-03-27T12:00:00Z" },
    "2026-03-28T06:00:00.000Z",
  ],
  [
    "Europe/London daily 06:00 from 2026-03-28T12:00Z is 2026-03-29T05:00Z (the BST crossing)",
    { cadence: "daily", runAtLocal: "06:00", timezone: "Europe/London", now: "2026-03-28T12:00:00Z" },
    "2026-03-29T05:00:00.000Z",
  ],
  [
    "Europe/London daily 06:00 from 2026-10-24T12:00Z is 2026-10-25T06:00Z (GMT again)",
    { cadence: "daily", runAtLocal: "06:00", timezone: "Europe/London", now: "2026-10-24T12:00:00Z" },
    "2026-10-25T06:00:00.000Z",
  ],
  [
    "Europe/London weekly Monday 07:00 from 2026-09-21T09:00Z (a Monday, 10:00 BST) is 2026-09-28T06:00Z",
    { cadence: "weekly", runAtLocal: "07:00", timezone: "Europe/London", now: "2026-09-21T09:00:00Z" },
    "2026-09-28T06:00:00.000Z",
  ],
  [
    "Asia/Kolkata monthly 05:00 from 2026-09-21T10:00Z is 2026-09-30T23:30Z (Oct 1 05:00 IST)",
    { cadence: "monthly", runAtLocal: "05:00", timezone: "Asia/Kolkata", now: "2026-09-21T10:00:00Z" },
    "2026-09-30T23:30:00.000Z",
  ],
];

export type ToInstantRow = readonly [
  label: string,
  input: { year: number; month: number; day: number; hour: number; minute: number; zone: string },
  expectedIso: string,
];

/** `toInstant` rows for the DST gap and fold (plan R-7). */
export const TO_INSTANT_ROWS: readonly ToInstantRow[] = [
  [
    "gap: 01:30 on 2026-03-29 Europe/London resolves to the first instant after the gap, 2026-03-29T01:30Z (02:30 BST)",
    { year: 2026, month: 3, day: 29, hour: 1, minute: 30, zone: "Europe/London" },
    "2026-03-29T01:30:00.000Z",
  ],
  [
    "fold: 01:30 on 2026-10-25 Europe/London resolves to the earlier occurrence, 2026-10-25T00:30Z (the BST one)",
    { year: 2026, month: 10, day: 25, hour: 1, minute: 30, zone: "Europe/London" },
    "2026-10-25T00:30:00.000Z",
  ],
];

export type PeriodForRow = readonly [
  label: string,
  input: { cadence: ReportCadence; runAt: string; zone: string },
  expected: { periodStart: string; periodEnd: string },
];

/** `periodFor` rows — the previous complete unit before the run's local date. */
export const PERIOD_FOR_ROWS: readonly PeriodForRow[] = [
  [
    "daily Asia/Kolkata at 2026-09-21T19:00Z (Sep 22 00:30 IST) is 2026-09-21..2026-09-21",
    { cadence: "daily", runAt: "2026-09-21T19:00:00Z", zone: "Asia/Kolkata" },
    { periodStart: "2026-09-21", periodEnd: "2026-09-21" },
  ],
  [
    "daily Europe/London on the run after the crossing (2026-03-29T05:00Z) is 2026-03-28..2026-03-28",
    { cadence: "daily", runAt: "2026-03-29T05:00:00Z", zone: "Europe/London" },
    { periodStart: "2026-03-28", periodEnd: "2026-03-28" },
  ],
  [
    "weekly Europe/London at 2026-09-28T06:00Z (Monday) is the seven days ending Sunday 2026-09-21..2026-09-27",
    { cadence: "weekly", runAt: "2026-09-28T06:00:00Z", zone: "Europe/London" },
    { periodStart: "2026-09-21", periodEnd: "2026-09-27" },
  ],
  [
    "monthly Asia/Kolkata at 2026-09-30T23:30Z (Oct 1 05:00 IST) is 2026-09-01..2026-09-30",
    { cadence: "monthly", runAt: "2026-09-30T23:30:00Z", zone: "Asia/Kolkata" },
    { periodStart: "2026-09-01", periodEnd: "2026-09-30" },
  ],
  [
    "monthly Asia/Kolkata at 2028-02-29T23:30Z (Mar 1 05:00 IST, a leap year) is 2028-02-01..2028-02-29",
    { cadence: "monthly", runAt: "2028-02-29T23:30:00Z", zone: "Asia/Kolkata" },
    { periodStart: "2028-02-01", periodEnd: "2028-02-29" },
  ],
];

export type OffsetRow = readonly [label: string, instant: string, zone: string, expectedMinutes: number];

export const UTC_OFFSET_ROWS: readonly OffsetRow[] = [
  ["Asia/Kolkata at 2026-09-21T10:00Z is +330", "2026-09-21T10:00:00Z", "Asia/Kolkata", 330],
  ["Europe/London at 2026-03-28T12:00Z is 0 (GMT)", "2026-03-28T12:00:00Z", "Europe/London", 0],
  ["Europe/London at 2026-03-29T12:00Z is +60 (BST)", "2026-03-29T12:00:00Z", "Europe/London", 60],
];

export type TimeZoneRow = readonly [label: string, zone: string, expected: boolean];

/**
 * R-6 as amended 2026-09-21: ICU canonicalises `Asia/Kolkata` to
 * `Asia/Calcutta` on Node 20.20.2 and 24.17.0, so the rule is slash +
 * constructs + segment casing, never resolved-name equality.
 */
export const TIME_ZONE_ROWS: readonly TimeZoneRow[] = [
  ["Asia/Kolkata is valid (ICU resolves it to Asia/Calcutta; the casing rule accepts it)", "Asia/Kolkata", true],
  ["Europe/London is valid", "Europe/London", true],
  ["Etc/GMT+5 is valid (a digit and a plus inside a segment)", "Etc/GMT+5", true],
  ["America/Argentina/Buenos_Aires is valid (three segments, an underscore)", "America/Argentina/Buenos_Aires", true],
  ["asia/kolkata is refused by the segment-casing rule, ICU accepts it", "asia/kolkata", false],
  ["Not/AZone is refused by RangeError at construction", "Not/AZone", false],
  ["UTC is refused (no slash)", "UTC", false],
  ["EST is refused (no slash; a fixed offset ICU maps to America/Panama)", "EST", false],
];

export function assertNextRunAtRow(row: NextRunAtRow): void {
  const [label, input, expected] = row;
  const actual = nextRunAt(
    { cadence: input.cadence, runAtLocal: input.runAtLocal, timezone: input.timezone },
    new Date(input.now),
  ).toISOString();
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

export function assertToInstantRow(row: ToInstantRow): void {
  const [label, input, expected] = row;
  const actual = toInstant(
    { year: input.year, month: input.month, day: input.day },
    { hour: input.hour, minute: input.minute },
    input.zone,
  ).toISOString();
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

export function assertPeriodForRow(row: PeriodForRow): void {
  const [label, input, expected] = row;
  const actual = periodFor(input.cadence, new Date(input.runAt), input.zone);
  assert(
    actual.periodStart === expected.periodStart && actual.periodEnd === expected.periodEnd,
    `${label}: expected ${expected.periodStart}..${expected.periodEnd}, got ${actual.periodStart}..${actual.periodEnd}`,
  );
}

export function assertUtcOffsetRow(row: OffsetRow): void {
  const [label, instant, zone, expected] = row;
  const actual = utcOffsetMinutes(new Date(instant), zone);
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

export function assertTimeZoneRow(row: TimeZoneRow): void {
  const [label, zone, expected] = row;
  const actual = isValidTimeZone(zone);
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

/** 2026-09-21 is a Monday; the weekday is read off the local calendar date, zone-free. */
export function assertWeekdayOfMonday(): void {
  const actual = weekdayOf({ year: 2026, month: 9, day: 21 });
  assert(actual === 1, `weekdayOf(2026-09-21) expected 1 (Monday), got ${actual}`);
}

export function assertParseRunAtLocalAcceptsSeconds(): void {
  const clock = parseRunAtLocal("07:05:00");
  assert(clock.hour === 7 && clock.minute === 5, `expected {7, 5}, got ${JSON.stringify(clock)}`);
}

export function assertParseRunAtLocalRefusesNonZeroSeconds(): void {
  assertThrowsReportPeriodError(() => parseRunAtLocal("07:05:30"), 'parseRunAtLocal("07:05:30")');
}

export function assertParseRunAtLocalRefusesOneDigitHour(): void {
  assertThrowsReportPeriodError(() => parseRunAtLocal("7:05"), 'parseRunAtLocal("7:05")');
}

/** The tick's per-row catch keys on `err.name` (R-6), so the name is the claim. */
export function assertNextRunAtRefusesUnknownZone(): void {
  assertThrowsReportPeriodError(
    () => nextRunAt({ cadence: "daily", runAtLocal: "06:00", timezone: "Not/AZone" }, new Date("2026-09-21T10:00:00Z")),
    "nextRunAt with Not/AZone",
  );
}

function assertThrowsReportPeriodError(fn: () => unknown, what: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ReportPeriodError, `${what}: expected a ReportPeriodError, got ${String(caught)}`);
  assert(
    (caught as Error).name === "ReportPeriodError",
    `${what}: expected name "ReportPeriodError", got ${(caught as Error).name}`,
  );
}
