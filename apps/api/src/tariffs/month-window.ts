import { formatIsoDate, localDateOf, toInstant } from "../reports/report-period";

/**
 * `F4.365` (ADR 0134 decision 4) — a billing month is a calendar month in the
 * location's zone (ADR 0070 `E4.1b`): `[local 1st 00:00, next local 1st 00:00)`.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIDNIGHT = { hour: 0, minute: 0 };

function parseMonth(month: string): { year: number; month: number } {
  const m = MONTH.exec(month);
  if (!m) throw new RangeError(`not a YYYY-MM month: ${month}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

/** The `YYYY-MM` month `instant` falls in, in `zone`. */
export function monthOf(instant: Date, zone: string): string {
  const d = localDateOf(instant, zone);
  return `${d.year}-${String(d.month).padStart(2, "0")}`;
}

/** `[start, end)` of `month` in `zone`. */
export function monthWindow(month: string, zone: string): { start: Date; end: Date } {
  const { year, month: m } = parseMonth(month);
  const next = m === 12 ? { year: year + 1, month: 1 } : { year, month: m + 1 };
  return {
    start: toInstant({ year, month: m, day: 1 }, MIDNIGHT, zone),
    end: toInstant({ year: next.year, month: next.month, day: 1 }, MIDNIGHT, zone),
  };
}

/** `YYYY-MM-01`, the date a version or mapping must be in force on (plan D8). */
export function monthFirstDay(month: string): string {
  const { year, month: m } = parseMonth(month);
  return formatIsoDate({ year, month: m, day: 1 });
}

/** The month before `month`. */
export function previousMonth(month: string): string {
  const { year, month: m } = parseMonth(month);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Amendment 1: the share of the month elapsed at `now`, 0..1 — the live
 * rate's fixed-charge fraction. 1 once the month is over.
 */
export function elapsedShare(window: { start: Date; end: Date }, now: Date): number {
  const total = window.end.getTime() - window.start.getTime();
  const done = Math.min(Math.max(now.getTime() - window.start.getTime(), 0), total);
  return total <= 0 ? 1 : done / total;
}
