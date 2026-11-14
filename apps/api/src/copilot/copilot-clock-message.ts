/**
 * `F4.360` defect 1 — the system line that tells the model the time now and the
 * zone to read the user's times in. Without it the model guessed the date: on
 * AWS (2026-11-14) it refused "until 08:25 IST today" at 08:11 IST, its end
 * having failed "must end in the future".
 *
 * The zone is the one the turn's usage counter uses (`copilot-usage.service.ts`
 * `governingZone`): the conversation's organization, else the user's home
 * organization, else UTC. It is already validated there, so this file formats
 * any zone `Intl` knows. The line follows the fixed prompt and the scope line,
 * so the cached prefix stays byte-stable (`F4.249`).
 */

const MINUTE_MS = 60_000;

type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: string; monthName: string };

/** The wall clock `zone` shows at `instant`, to the minute, with the weekday and month names. */
function wallIn(instant: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  const numeric = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "numeric" }).format(instant);
  const hour = Number(part("hour"));
  return {
    year: Number(part("year")),
    month: Number(numeric),
    day: Number(part("day")),
    // Some ICU builds print midnight as "24" even under h23.
    hour: hour === 24 ? 0 : hour,
    minute: Number(part("minute")),
    weekday: part("weekday"),
    monthName: part("month"),
  };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `+05:30`, `-05:00`, `+00:00`. */
function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/**
 * `F4.360` review: a conversation with no zone of its own — every organization, for a user with no home
 * organization (the global admin) — is given UTC as a fact, never as the zone to read a bare time in: the
 * model asks which zone the user means, so "08:25" is never read as 08:25 UTC by default.
 */
const NO_ZONE_RULE =
  "This conversation spans organizations and has no local zone: when the user gives a time without a zone, ask which zone they mean before you propose anything with it. ";

/**
 * The system line for one turn: the time now in UTC and in `zone`, and how to write a time the user gives.
 * `hasOwnZone` false: the zone is the UTC fallback of a conversation with no zone of its own.
 */
export function copilotClockMessage(now: Date, zone: string, hasOwnZone = true): string {
  const atMinute = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const wall = wallIn(atMinute, zone);
  const offset = offsetLabel(
    Math.round((Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - atMinute.getTime()) / MINUTE_MS),
  );
  const date = `${wall.year}-${two(wall.month)}-${two(wall.day)}`;
  const clock = `${two(wall.hour)}:${two(wall.minute)}`;
  const utc = `${atMinute.toISOString().slice(0, 16)}:00Z`;
  return (
    `The time now is ${utc} (UTC), which is ${wall.weekday} ${wall.day} ${wall.monthName} ${wall.year}, ${clock} in ${zone} (UTC${offset}). ` +
    (hasOwnZone
      ? `Read a time the user gives without a zone, and "now", "today" and "tomorrow", in ${zone}; a time the user gives in a named zone (IST, UTC) keeps that zone. `
      : NO_ZONE_RULE) +
    `Write a date-time field as ISO 8601 with its offset; now is ${date}T${clock}:00${offset}.`
  );
}
