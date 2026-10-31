import { BadRequestException } from "@nestjs/common";

import {
  MAX_WIDGET_WINDOW_MINUTES,
  resolveSiteTimeZone,
  type AggregateLevel,
  type EnergyViewQuery,
  type ResolvedSiteTimeZone,
} from "@bms/shared";

import { levelForRange } from "../telemetry/point-aggregates";
import { localDateOf, toInstant } from "./report-period";

/**
 * `F4.298` U2 (ADR 0108 decisions 2.2, 2.4 and 2.8) — the energy view's range
 * arithmetic, pure. The service resolves the zone, then the range, then the
 * compare period, then one level for both periods.
 *
 * Bounds follow the reports path's inclusive convention: SQL reads
 * `bucket >= start AND bucket <= end`. A preset ends at `now`; `custom` ends at
 * `to`. The compare period ends 1 ms before the current start, so the two
 * periods never share a bucket.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MIDNIGHT = { hour: 0, minute: 0 } as const;
const MAX_CUSTOM_MS = MAX_WIDGET_WINDOW_MINUTES * MINUTE_MS;

/** One period of the view: `start` and an inclusive `end`, and its length in hours. */
export type EnergyViewPeriodRange = { start: Date; end: Date; durationHours: number };

/** The trailing presets, in hours. `1y` is 365 × 24 h (ADR 0108 decision 2.2). */
const TRAILING_HOURS = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "1y": 365 * 24,
} as const satisfies Partial<Record<EnergyViewQuery["range"], number>>;

/**
 * The view's zone: the one location → organization → `Etc/UTC` chain of
 * `@bms/shared` (decision 2.8). A stored `"UTC"` is reported as `"UTC"` and
 * computed on `Etc/UTC`; an invalid zone falls to the next link, never a 500.
 * The caller passes `null` for the location unless exactly one is named.
 */
export function zoneForArithmetic(locationZone: string | null, organizationZone: string | null): ResolvedSiteTimeZone {
  return resolveSiteTimeZone(locationZone, organizationZone);
}

function periodOf(start: Date, end: Date): EnergyViewPeriodRange {
  return { start, end, durationHours: (end.getTime() - start.getTime()) / HOUR_MS };
}

function customRange(from: string | undefined, to: string | undefined): EnergyViewPeriodRange {
  if (from === undefined) {
    throw new BadRequestException("A custom range needs from");
  }
  if (to === undefined) {
    throw new BadRequestException("A custom range needs to");
  }
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new BadRequestException("Invalid custom range instant");
  }
  if (start.getTime() >= end.getTime()) {
    throw new BadRequestException("A custom range from must be before to");
  }
  if (end.getTime() - start.getTime() > MAX_CUSTOM_MS) {
    throw new BadRequestException("A custom range is limited to 365 days");
  }
  return periodOf(start, end);
}

/**
 * The current period. `today` and `this_month` start at local midnight of the
 * day, or of the first day of the month, in `zone.arithmeticZone` — elapsed
 * time, so a DST day counts its real 23 or 25 hours. A cross-field fault of a
 * `custom` range is a 400, the `energyReportRange` precedent.
 */
export function resolveEnergyRange(
  query: Pick<EnergyViewQuery, "range" | "from" | "to">,
  zone: ResolvedSiteTimeZone,
  now: Date,
): EnergyViewPeriodRange {
  switch (query.range) {
    case "custom":
      return customRange(query.from, query.to);
    case "today":
      return periodOf(toInstant(localDateOf(now, zone.arithmeticZone), MIDNIGHT, zone.arithmeticZone), now);
    case "this_month": {
      const today = localDateOf(now, zone.arithmeticZone);
      return periodOf(toInstant({ ...today, day: 1 }, MIDNIGHT, zone.arithmeticZone), now);
    }
    case "24h":
    case "7d":
    case "30d":
    case "1y":
      return periodOf(new Date(now.getTime() - TRAILING_HOURS[query.range] * HOUR_MS), now);
  }
}

/**
 * The compare period: the equal-length period that ends at the current start.
 * The current `[s, e]` is `len = e − s` long; the previous one is
 * `[s − len, s − 1 ms]`, so no bucket at or after `s` is read twice.
 */
export function previousPeriod(current: EnergyViewPeriodRange): EnergyViewPeriodRange {
  const lengthMs = current.end.getTime() - current.start.getTime();
  return {
    start: new Date(current.start.getTime() - lengthMs),
    end: new Date(current.start.getTime() - 1),
    durationHours: current.durationHours,
  };
}

/** The display bucket from the range length: ≤ 3 h `1m`, ≤ 48 h `5m`, ≤ 45 d `1h`, else `1d`. */
export function displayBucketFor(durationHours: number): AggregateLevel {
  if (durationHours <= 3) {
    return "1m";
  }
  if (durationHours <= 48) {
    return "5m";
  }
  if (durationHours <= 45 * 24) {
    return "1h";
  }
  return "1d";
}

const LEVEL_ORDER: Readonly<Record<AggregateLevel, number>> = { "1m": 0, "5m": 1, "1h": 2, "1d": 3 };

/**
 * One read level for the whole view (decision 2.4). The level is the bucket,
 * except that a `1d` bucket reads `_1h`: `point_values_1d` holds UTC days, and
 * a zone day is `time_bucket(INTERVAL '1 day', bucket, zone)` over `_1h`.
 * `levelForRange` is called once, with the older period's start, so one level
 * serves both periods; if retention coarsens it past the bucket, the bucket
 * becomes the level.
 */
export function levelAndBucketFor({
  bucket,
  olderStart,
  now,
}: {
  bucket: AggregateLevel;
  olderStart: Date;
  now: Date;
}): { level: AggregateLevel; bucket: AggregateLevel } {
  const granularity: AggregateLevel = bucket === "1d" ? "1h" : bucket;
  const { level } = levelForRange({ start: olderStart, granularity, now });
  return { level, bucket: LEVEL_ORDER[level] > LEVEL_ORDER[bucket] ? level : bucket };
}
