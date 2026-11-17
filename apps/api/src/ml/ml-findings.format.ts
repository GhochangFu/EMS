/**
 * `E1.9a` / ADR 0135 Amendment 8 (plan §4.1) — the words and formats of the
 * fact sentences, pure: no database and no clock.
 *
 * A value is the Forecasts table's `formatValue` (at most 2 decimals, no
 * grouping), with an ASCII `-` and then a space and the unit when the point has
 * one. A time is `17 Nov 14:05` in the named asset's site zone, the history
 * page's `formatShortInZone` shape.
 */

/** A value with at most 2 decimals and no grouping, then ` <unit>` when there is one. */
export function formatFindingValue(value: number, unit: string | null): string {
  const text = value
    .toLocaleString("en-GB", { maximumFractionDigits: 2, useGrouping: false })
    .replace(/−/g, "-")
    .replace(/^-0$/, "0");
  return unit === null || unit === "" ? text : `${text} ${unit}`;
}

/** A change with its sign: `+1.5 °C`, `-2 °C`. */
export function formatSignedChange(value: number, unit: string | null): string {
  const text = formatFindingValue(value, unit);
  return text.startsWith("-") ? text : `+${text}`;
}

function formatterIn(zone: string): { day: Intl.DateTimeFormat; time: Intl.DateTimeFormat } {
  return {
    day: new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }),
    time: new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

/** `17 Nov 14:05` in `zone`; a zone the runtime does not know falls back to `UTC`. */
export function formatFindingTime(ms: number, zone: string): string {
  let format: ReturnType<typeof formatterIn>;
  try {
    format = formatterIn(zone === "" ? "UTC" : zone);
  } catch {
    format = formatterIn("UTC");
  }
  return `${format.day.format(ms)} ${format.time.format(ms)}`;
}

/** Decision 2: `coldest` / `warmest` for a `°C` point, else `lowest` / `highest`. */
export function tempWords(unit: string | null): { low: string; high: string } {
  return unit === "°C" ? { low: "coldest", high: "warmest" } : { low: "lowest", high: "highest" };
}
