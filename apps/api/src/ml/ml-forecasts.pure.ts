import {
  FORECAST_MAX_HORIZON_HOURS,
  FORECAST_STALE_AFTER_HOURS,
  resolveSiteTimeZone,
  type ForecastListRow,
  type PointForecast,
} from "@bms/shared";

/**
 * `E1.4a` / ADR 0135 Amendment 3 C3, C4, C7 (plan R1–R3) — the step between
 * the SQL rows and the wire, with no database and no clock of its own: every
 * function takes the current hour the request computed once (R2).
 *
 * Times arrive from SQL as epoch milliseconds (`float8`, the device-health
 * reads' rule), so no driver date parsing and no session zone is involved.
 */
export const HOUR_MS = 3_600_000;

/** The UTC hour `now` falls in, in epoch ms: the bound C4's `date_trunc('hour', now(), 'UTC')` is. */
export function currentHourOf(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
}

/** The earliest issue time, and the earliest bucket, either read looks at (R3). */
export function lookBackStartOf(currentHourMs: number): number {
  return currentHourMs - FORECAST_MAX_HORIZON_HOURS * HOUR_MS;
}

/** C3: stale when the run's first bucket (the hour it scored) is more than 3 h before the current hour. */
export function isStale(firstBucketMs: number, currentHourMs: number): boolean {
  return currentHourMs - firstBucketMs > FORECAST_STALE_AFTER_HOURS * HOUR_MS;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** One row of the one-point read: a bucket of the current run, ascending, from the run's first bucket. */
export type PointForecastDbRow = {
  bucket_ms: number;
  p10: number;
  p50: number;
  p90: number;
  issued_ms: number;
  model_name: string;
  model_version: string;
};

/**
 * The current run's rows → the wire shape, or `null` when there is no row or
 * no bucket at or after the current hour. The first row's bucket is the run's
 * first bucket, so it decides `stale`; the buckets before the current hour are
 * then dropped, so bucket 0 is the hour in progress (C4).
 */
export function toPointForecast(rows: readonly PointForecastDbRow[], currentHourMs: number): PointForecast | null {
  const first = rows[0];
  if (!first) {
    return null;
  }
  const buckets = rows
    .filter((row) => row.bucket_ms >= currentHourMs)
    .map((row) => ({ t: iso(row.bucket_ms), p10: row.p10, p50: row.p50, p90: row.p90 }));
  if (buckets.length === 0) {
    return null;
  }
  return {
    issuedAt: iso(first.issued_ms),
    modelName: first.model_name,
    modelVersion: first.model_version,
    stale: isStale(first.bucket_ms, currentHourMs),
    buckets,
  };
}

/** One row of the list read, every column aliased (plan §16 B1). */
export type ForecastListDbRow = {
  asset_id: string;
  point_key: string;
  issued_ms: number;
  model_name: string;
  model_version: string;
  first_bucket_ms: number;
  p50_min: number;
  p50_max: number;
  p50_peak_ms: number;
  asset_code: string;
  asset_name: string;
  location_id: string;
  location_name: string;
  location_time_zone: string | null;
  organization_time_zone: string | null;
  unit: string | null;
};

/**
 * One list row → the wire shape. The zone is the history page's chain,
 * location first, then organization, then `UTC` (C7); `.timeZone`, the stored
 * value, as `resolveSiteTimeZone` reports it.
 */
export function toForecastListRow(row: ForecastListDbRow, currentHourMs: number): ForecastListRow {
  return {
    assetId: row.asset_id,
    assetCode: row.asset_code,
    assetName: row.asset_name,
    locationId: row.location_id,
    locationName: row.location_name,
    timeZone: resolveSiteTimeZone(row.location_time_zone, row.organization_time_zone).timeZone,
    pointKey: row.point_key,
    unit: row.unit,
    issuedAt: iso(row.issued_ms),
    modelName: row.model_name,
    modelVersion: row.model_version,
    stale: isStale(row.first_bucket_ms, currentHourMs),
    p50Min: row.p50_min,
    p50Max: row.p50_max,
    p50PeakAt: iso(row.p50_peak_ms),
  };
}
