import type {
  AggregateLevel,
  EnergyFilterLocation,
  EnergyFilterOptions,
  EnergyViewPartial,
  EnergyViewPeriod,
  EnergyViewQuery,
  EnergyViewRange,
} from "@bms/shared";

import { percentChange } from "./energy-organization-views";

/**
 * `F4.298` U5 (ADR 0108 decision 2) — the Energy page's pure filter helpers.
 *
 * **Times are in the view's zone, never the browser's** (ADR 0108 Status
 * ruling c). The zone is the `timeZone` the `energy/view` response returns —
 * the site's when one location is named, else the organization's, by the
 * shared `resolveSiteTimeZone` chain on the server. The custom `datetime-local`
 * picker reads and writes wall time in that zone, and the label names it. No
 * helper here calls a `Date` getter that reads the browser's local zone.
 */

/** The filter bar's value. `from`/`to` are ISO instants, carried only by `range: "custom"`. */
export type EnergyFilterValue = {
  organizationId: string;
  locationIds: string[];
  range: EnergyViewRange;
  from?: string;
  to?: string;
  compare?: "previous";
};

/** The seven ranges, in the order the select lists them. */
export const ENERGY_RANGES: readonly { value: EnergyViewRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "1y", label: "Last 365 days" },
  { value: "custom", label: "Custom" },
];

/** The change of one KPI against the previous period (decision 2.6). */
export type EnergyChange =
  | { kind: "none" }
  | { kind: "no_previous" }
  /** The previous period has data but not this figure (e.g. no `pf` samples). */
  | { kind: "no_previous_value" }
  /** `pct: null` when the previous figure is zero. */
  | { kind: "change"; pct: number | null };

/**
 * The change of `key` against the compare period. Computed only when both
 * periods have data; a zero previous figure has no percent (no `Infinity`).
 */
export function changeFor(
  current: EnergyViewPeriod,
  compare: EnergyViewPeriod | null,
  key: "totalKwh" | "peakKw" | "avgPf",
): EnergyChange {
  if (compare === null || !current.hasData) {
    return { kind: "none" };
  }
  if (!compare.hasData) {
    return { kind: "no_previous" };
  }
  const now = current[key];
  const before = compare[key];
  if (now === null) {
    return { kind: "none" };
  }
  if (before === null) {
    return { kind: "no_previous_value" };
  }
  return { kind: "change", pct: percentChange(now, before) };
}

function bucketName(bucket: AggregateLevel): string {
  switch (bucket) {
    case "1m":
      return "1 minute";
    case "5m":
      return "5 minute";
    case "1h":
      return "1 hour";
    case "1d":
      return "1 day";
  }
}

/** The rollup tile, e.g. `1h rollup · 1 day buckets · Asia/Kolkata` (decision 2.12). */
export function levelLabel(level: AggregateLevel, bucket: AggregateLevel, zone: string): string {
  return `${level} rollup · ${bucketName(bucket)} buckets · ${zone}`;
}

/** The partial-access note, or `null` when the caller reads every selected site. */
export function partialNote(partial: EnergyViewPartial | null): string | null {
  if (partial === null || partial.readableSites === partial.selectedSites) {
    return null;
  }
  return `partial — your access covers ${partial.readableSites} of ${partial.selectedSites} sites`;
}

/** The first readable organization, preselected (owner answer Q3), the whole organization, the last 24 h. */
export function defaultFilter(options: EnergyFilterOptions): EnergyFilterValue {
  return { organizationId: options.organizations[0]?.id ?? "", locationIds: [], range: "24h" };
}

/** The readable locations of one organization, in the order the server sent them. */
export function locationsOfOrganization(options: EnergyFilterOptions, organizationId: string): EnergyFilterLocation[] {
  return options.locations.filter((location) => location.organizationId === organizationId);
}

/**
 * The query to send, or `null` when there is nothing valid to ask: no
 * organization (there is no fleet-wide view), or a custom range without both
 * ends (the service would answer 400). Empty keys are left out.
 */
export function energyViewQueryOf(filter: EnergyFilterValue): EnergyViewQuery | null {
  if (filter.organizationId === "") {
    return null;
  }
  const query: EnergyViewQuery = { range: filter.range, organizationId: filter.organizationId };
  if (filter.locationIds.length > 0) {
    query.locationIds = [...filter.locationIds];
  }
  if (filter.range === "custom") {
    if (filter.from === undefined || filter.to === undefined) {
      return null;
    }
    query.from = filter.from;
    query.to = filter.to;
  }
  if (filter.compare === "previous") {
    query.compare = "previous";
  }
  return query;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The wall time of `ms` in `zone`, as a `datetime-local` value (`YYYY-MM-DDTHH:mm`). */
function wallOf(ms: number, zone: string): string {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  // Some ICU builds print midnight as "24" even under h23.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/** The zone's offset at `ms`, in minutes east of UTC. */
function offsetMinutes(ms: number, zone: string): number {
  const match = LOCAL_INPUT.exec(wallOf(ms, zone)) as RegExpExecArray;
  const wallMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const flooredMs = Math.floor(ms / MINUTE_MS) * MINUTE_MS;
  return Math.round((wallMs - flooredMs) / MINUTE_MS);
}

/** An ISO instant as a `datetime-local` value in `zone`; `""` when there is no valid instant. */
export function instantToZoneInput(iso: string | undefined, zone: string): string {
  const ms = iso === undefined ? Number.NaN : Date.parse(iso);
  return Number.isNaN(ms) ? "" : wallOf(ms, zone);
}

/**
 * A `datetime-local` value read as wall time in `zone`, as an ISO instant; `null`
 * when the value is not `YYYY-MM-DDTHH:mm`. The `report-period.ts` `toInstant`
 * rule: a fold resolves to the earlier occurrence, a gap carries the wall
 * clock forward by the gap's width (the smallest candidate offset).
 */
export function zoneInputToInstant(value: string, zone: string): string | null {
  const match = LOCAL_INPUT.exec(value);
  if (match === null) {
    return null;
  }
  const naiveMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  const firstOffset = offsetMinutes(naiveMs, zone);
  const guessMs = naiveMs - firstOffset * MINUTE_MS;
  const candidates = new Set<number>([
    firstOffset,
    offsetMinutes(guessMs - DAY_MS, zone),
    offsetMinutes(guessMs, zone),
    offsetMinutes(guessMs + DAY_MS, zone),
  ]);
  let earliest: number | undefined;
  for (const offset of candidates) {
    const candidateMs = naiveMs - offset * MINUTE_MS;
    if (wallOf(candidateMs, zone) === value && (earliest === undefined || candidateMs < earliest)) {
      earliest = candidateMs;
    }
  }
  const resolved = earliest ?? naiveMs - Math.min(...candidates) * MINUTE_MS;
  return new Date(resolved).toISOString();
}

/** The picker's label: it names the zone the inputs are read in. */
export function zoneLabel(zone: string): string {
  return `Times in ${zone}`;
}
