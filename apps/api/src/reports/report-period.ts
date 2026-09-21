import type { ReportCadence } from "@bms/shared";

/**
 * `F3.5b` U3 — scheduled-report period arithmetic in the schedule's IANA
 * zone (ADR 0071 decision 7; plan R-6, R-7, R-8).
 *
 * **No date library** (decision 7): `Intl.DateTimeFormat` gives the wall
 * components of an instant in a zone, and `Date.UTC` turns wall components
 * back into a proleptic-Gregorian instant. Nothing here reads the host zone
 * — no `new Date(y, m, d)`, no `getDay()`, no `getHours()` — because the
 * worker's `TZ` is whatever the container says and a fixture that passes on
 * a UTC host is not a proof (E4.1b's trap; the spec pins
 * `TZ=America/St_Johns`).
 *
 * **Zone validity (R-6, amended 2026-09-21).** `isValidTimeZone` is: the
 * name contains `/`; `new Intl.DateTimeFormat("en-US", { timeZone })`
 * constructs without `RangeError`; and every `/`-segment starts with an
 * uppercase letter. The plan first wrote `resolvedOptions().timeZone ===
 * zone` (exact case, E4.1b's ruling for `locations.timezone`), but ICU
 * canonicalises `Asia/Kolkata` to `Asia/Calcutta` on Node 20.20.2 (the `api`
 * container) and 24.17.0 (the host), and `Intl.supportedValuesOf("timeZone")`
 * lists `Asia/Calcutta` only — the equality refused the pilot's own zone.
 * The segment-casing regex keeps `asia/kolkata` refused (ICU accepts it);
 * `Etc/GMT+5`, `America/Port-au-Prince`, `America/Argentina/Buenos_Aires`
 * pass. Slash-less names (`UTC`, `EST` — a fixed −05:00 ICU maps to
 * `America/Panama`) are refused as in E4.1b.
 *
 * **Gap and fold (`toInstant`).** A wall time is resolved by trying the
 * zone's offset at the naive instant and the offsets a day either side of the
 * instant that first guess yields; each candidate offset gives a candidate instant, and
 * a candidate is *valid* when formatting it back in the zone reproduces the
 * wall time. A wall time inside a DST **gap** (01:30 on the spring-forward
 * night) has no valid candidate and resolves to the first instant after the
 * gap (the naive instant minus the pre-gap offset — 02:30 BST for London's
 * 01:30). A wall time in a **fold** (01:30 on the fall-back night) has two
 * valid candidates and resolves to the **earlier** one (the BST occurrence).
 * A plain two-pass resolution lands the fold on the later occurrence, which
 * is why the candidates are enumerated and the earliest valid one kept.
 *
 * **Strictly after (`nextRunAt`).** The result is the first occurrence
 * whose instant is `> now`, never `>= now`: a row whose `next_run_at` equals
 * `now` is due *this* tick and its next run is the following occurrence
 * (R-8 — the tick enqueues for the due instant, then advances from now).
 *
 * **`weekdayOf`** reads `Date.UTC(y, m - 1, d)` and `getUTCDay()` on the
 * *local* calendar date: the weekday of a proleptic-Gregorian date is a
 * property of the date, not of any zone, so the UTC projection of the local
 * triple is exact — and it never touches the host zone.
 */
export class ReportPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportPeriodError";
  }
}

export type LocalDate = { readonly year: number; readonly month: number; readonly day: number };
export type LocalClock = { readonly hour: number; readonly minute: number };

const ZONE_SEGMENT_CASING = /^[A-Z][A-Za-z0-9_+-]*(\/[A-Z][A-Za-z0-9_+-]*)+$/;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** R-6: contains `/`, constructs without `RangeError`, every segment capitalised. */
export function isValidTimeZone(zone: string): boolean {
  if (!zone.includes("/") || !ZONE_SEGMENT_CASING.test(zone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch (err) {
    if (err instanceof RangeError) {
      return false;
    }
    throw err;
  }
}

/** Accepts `HH:MM` and `HH:MM:SS` (what `pg` returns for `time`); seconds must be `00`. */
export function parseRunAtLocal(value: string): LocalClock {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    throw new ReportPeriodError(`runAtLocal "${value}" is not HH:MM or HH:MM:SS`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second !== 0) {
    throw new ReportPeriodError(`runAtLocal "${value}" is out of range or carries seconds`);
  }
  return { hour, minute };
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached) {
    return cached;
  }
  if (!isValidTimeZone(zone)) {
    throw new ReportPeriodError(`"${zone}" is not a known IANA zone`);
  }
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(zone, created);
  return created;
}

type WallTime = LocalDate & LocalClock & { readonly second: number };

function wallTimeOf(instant: Date, zone: string): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(zone).formatToParts(instant)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Some ICU builds print midnight as "24" even under h23 — guard it.
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function wallToNaiveUtcMs(wall: WallTime): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/** `formatToParts` in `zone` → wall components → `Date.UTC(wall) − instant`, in minutes. */
export function utcOffsetMinutes(instant: Date, zone: string): number {
  return Math.round((wallToNaiveUtcMs(wallTimeOf(instant, zone)) - instant.getTime()) / MINUTE_MS);
}

export function localDateOf(instant: Date, zone: string): LocalDate {
  const wall = wallTimeOf(instant, zone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

export function formatIsoDate(date: LocalDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}

/** Calendar arithmetic via `Date.UTC`; never a local `Date`. */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** ISO weekday: Monday = 1 … Sunday = 7, read off the local calendar date (zone-free). */
export function weekdayOf(date: LocalDate): number {
  const utcDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

/**
 * The instant at which `zone` shows `date` + `clock`. Gap → the first
 * instant after the gap; fold → the earlier occurrence (see the docblock).
 */
export function toInstant(date: LocalDate, clock: LocalClock, zone: string): Date {
  const naiveMs = Date.UTC(date.year, date.month - 1, date.day, clock.hour, clock.minute);
  // First pass: the offset the zone has at the naive instant.
  const firstOffset = utcOffsetMinutes(new Date(naiveMs), zone);
  const firstGuessMs = naiveMs - firstOffset * MINUTE_MS;
  // Second pass: the offsets a day either side of the first guess, so a
  // transition between the naive instant and the true instant — or the
  // pre-transition offset a fold needs — is among the candidates.
  const candidates = new Set<number>([
    firstOffset,
    utcOffsetMinutes(new Date(firstGuessMs - DAY_MS), zone),
    utcOffsetMinutes(new Date(firstGuessMs), zone),
    utcOffsetMinutes(new Date(firstGuessMs + DAY_MS), zone),
  ]);
  let earliestValid: number | undefined;
  for (const offset of candidates) {
    const candidateMs = naiveMs - offset * MINUTE_MS;
    const wall = wallTimeOf(new Date(candidateMs), zone);
    const roundTrips =
      wall.year === date.year &&
      wall.month === date.month &&
      wall.day === date.day &&
      wall.hour === clock.hour &&
      wall.minute === clock.minute;
    if (roundTrips && (earliestValid === undefined || candidateMs < earliestValid)) {
      earliestValid = candidateMs;
    }
  }
  if (earliestValid !== undefined) {
    return new Date(earliestValid);
  }
  // A gap: neither offset reproduces the wall time. The pre-gap offset is the
  // larger candidate's complement — subtracting the smaller offset lands after
  // the gap, so take the latest candidate instant (= the smallest offset).
  const postGapOffset = Math.min(...candidates);
  return new Date(naiveMs - postGapOffset * MINUTE_MS);
}

function satisfiesCadence(cadence: ReportCadence, date: LocalDate): boolean {
  switch (cadence) {
    case "daily":
      return true;
    case "weekly":
      return weekdayOf(date) === 1;
    case "monthly":
      return date.day === 1;
  }
}

/**
 * The first instant strictly after `now` whose local wall time is
 * `runAtLocal` and whose local date satisfies the cadence (daily: any day;
 * weekly: Monday; monthly: day 1).
 */
export function nextRunAt(
  schedule: { cadence: ReportCadence; runAtLocal: string; timezone: string },
  now: Date,
): Date {
  const clock = parseRunAtLocal(schedule.runAtLocal);
  let date = localDateOf(now, schedule.timezone);
  // At most one full cycle: 31 days covers the monthly case from day 2.
  for (let step = 0; step < 40; step += 1) {
    if (satisfiesCadence(schedule.cadence, date)) {
      const candidate = toInstant(date, clock, schedule.timezone);
      if (candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
    date = addLocalDays(date, 1);
  }
  throw new ReportPeriodError(`no ${schedule.cadence} occurrence found within 40 days of ${now.toISOString()}`);
}

/**
 * The previous complete unit before `runAt`'s local date, as ISO dates:
 * daily → the local day before; weekly → the Monday..Sunday week strictly
 * before (the seven local days ending the previous Sunday); monthly → the
 * previous calendar month.
 */
export function periodFor(
  cadence: ReportCadence,
  runAt: Date,
  zone: string,
): { periodStart: string; periodEnd: string } {
  const local = localDateOf(runAt, zone);
  switch (cadence) {
    case "daily": {
      const day = addLocalDays(local, -1);
      return { periodStart: formatIsoDate(day), periodEnd: formatIsoDate(day) };
    }
    case "weekly": {
      const previousSunday = addLocalDays(local, -weekdayOf(local));
      return { periodStart: formatIsoDate(addLocalDays(previousSunday, -6)), periodEnd: formatIsoDate(previousSunday) };
    }
    case "monthly": {
      const lastOfPrevious = addLocalDays({ year: local.year, month: local.month, day: 1 }, -1);
      return {
        periodStart: formatIsoDate({ year: lastOfPrevious.year, month: lastOfPrevious.month, day: 1 }),
        periodEnd: formatIsoDate(lastOfPrevious),
      };
    }
  }
}
