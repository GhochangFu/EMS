/**
 * `F4.359` U15 (review fix) — a maintenance window's times are read and written in the browser's
 * own zone, everywhere: the wizards' `datetime-local` inputs, the "Now ends" line, the Review
 * detail and the page's Start and End columns, each labelled with {@link localZoneLabel}. The API
 * speaks ISO instants; these are the only two crossings.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:MM`, optionally `:SS` — exactly what a `datetime-local` input yields. */
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A `datetime-local` input's value for `date`, in the browser's zone. */
export function localInputOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * The ISO instant of a `datetime-local` value, read as wall-clock time in the browser's zone;
 * `undefined` when empty or not that shape (an instant with its own zone is not a local value).
 */
export function isoOfLocalInput(text: string): string | undefined {
  const match = LOCAL_INPUT.exec(text.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const at = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** "2026-11-13 15:00": the minute of `iso` in the browser's zone. */
export function localMinuteOf(iso: string): string {
  return localInputOf(new Date(iso)).replace("T", " ");
}

/** "UTC+05:30", "UTC-03:30" or "UTC": the browser zone's offset at `at`. */
export function localZoneLabel(at: Date = new Date()): string {
  const east = -at.getTimezoneOffset();
  if (east === 0) return "UTC";
  const abs = Math.abs(east);
  return `UTC${east > 0 ? "+" : "-"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
