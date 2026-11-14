import { z } from "zod";

/** The path parameter rule for a row id, the same as the controllers' `idParamSchema`. */
export const uuidParam = z.string().uuid();

/** The body of a route that takes none: the stored, hashed and sent body is `{}` (plan §6.4). */
export const emptyBody = z.object({}).strict();

/** A name as a card shows it. */
export function quoted(name: string): string {
  return `"${name}"`;
}

/** The body's keys, in the order sent, as a readable list: "name, slug and description". */
export function fieldList(body: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(body);
  if (keys.length === 0) return "nothing";
  if (keys.length === 1) return keys[0] as string;
  return `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`;
}

/** A string field of the body, or the fallback when it is absent or not a string. */
export function text(body: Readonly<Record<string, unknown>>, key: string, fallback = ""): string {
  const value = body[key];
  return typeof value === "string" ? value : fallback;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * `F4.360` defect 4: an ISO instant as a card says it — "2026-11-13 13:30 (UTC+05:30)" in `timeZone`
 * (the page's `localZoneLabel` form, "(UTC)" at offset zero), or "2026-11-13 08:00 (UTC)" with no zone.
 * A string that is not an instant is returned as it is; a zone the runtime does not know falls back to UTC.
 */
export function instantText(iso: string, timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const utc = `${at.toISOString().slice(0, 16).replace("T", " ")} (UTC)`;
  if (timeZone === undefined) return utc;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
  } catch {
    // A zone this runtime does not know is said in UTC, never a failed summary.
    return utc;
  }
  const n = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value);
  const hour = n("hour") === 24 ? 0 : n("hour");
  const wallMs = Date.UTC(n("year"), n("month") - 1, n("day"), hour, n("minute"));
  const east = Math.round((wallMs - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  const abs = Math.abs(east);
  const zone = east === 0 ? "UTC" : `UTC${east > 0 ? "+" : "-"}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return `${n("year")}-${pad2(n("month"))}-${pad2(n("day"))} ${pad2(hour)}:${pad2(n("minute"))} (${zone})`;
}
