import { forecastListRowSchema, pointForecastSchema } from "@bms/shared";
import { expect } from "vitest";

import {
  HOUR_MS,
  currentHourOf,
  isStale,
  lookBackStartOf,
  toForecastListRow,
  toPointForecast,
  type ForecastListDbRow,
  type PointForecastDbRow,
} from "./ml-forecasts.pure";

/**
 * `E1.4a` / ADR 0135 Amendment 3 C3, C4, C7, R1–R3 — the pure step between the
 * SQL and the wire. Assertions live here; `ml-forecasts.pure.test.ts` is the
 * vitest entry point (ADR 0014). Plan `docs/plans/e1.4-forecast-read-path.md`
 * §5, T1.9.
 */
const CURRENT = Date.parse("2026-11-16T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** A run's rows from `firstBucketMs`, `count` consecutive hours. */
const runRows = (firstBucketMs: number, count: number): PointForecastDbRow[] =>
  Array.from({ length: count }, (_, h) => ({
    bucket_ms: firstBucketMs + h * HOUR_MS,
    p10: 9 + h,
    p50: 10 + h,
    p90: 11 + h,
    issued_ms: firstBucketMs + 5 * 60_000,
    model_name: "amazon/chronos-2",
    model_version: "0".repeat(40),
  }));

const listRow = (over: Partial<ForecastListDbRow> = {}): ForecastListDbRow => ({
  asset_id: "11111111-1111-4111-8111-111111111111",
  point_key: "temp_c",
  issued_ms: CURRENT + 5 * 60_000,
  model_name: "amazon/chronos-2",
  model_version: "0".repeat(40),
  first_bucket_ms: CURRENT,
  p50_min: -18.5,
  p50_max: -17.25,
  p50_peak_ms: CURRENT + 4 * HOUR_MS,
  asset_code: "WBLDC-CR1",
  asset_name: "Cold room 1",
  asset_rtu_name: "WBLDC RTU 1",
  location_id: "22222222-2222-4222-8222-222222222222",
  location_name: "Kolkata DC",
  location_time_zone: "Asia/Kolkata",
  organization_time_zone: "Africa/Johannesburg",
  unit: "°C",
  ...over,
});

export function theCurrentHourIsTheUtcHourNowIsIn(): void {
  expect(currentHourOf(new Date("2026-11-16T10:59:59.999Z"))).toBe(CURRENT);
  expect(currentHourOf(new Date("2026-11-16T10:00:00.000Z"))).toBe(CURRENT);
  // 15:30 IST is 10:00 UTC: the floor is UTC's, whatever zone the process runs in.
  expect(currentHourOf(new Date("2026-11-16T15:30:00.000+05:30"))).toBe(CURRENT);
  expect(lookBackStartOf(CURRENT)).toBe(CURRENT - 64 * HOUR_MS);
}

export function staleIsMoreThanThreeHoursAfterTheFirstBucket(): void {
  expect(isStale(CURRENT - 4 * HOUR_MS, CURRENT)).toBe(true);
  expect(isStale(CURRENT - 3 * HOUR_MS, CURRENT)).toBe(false);
  expect(isStale(CURRENT, CURRENT)).toBe(false);
  expect(toPointForecast(runRows(CURRENT - 4 * HOUR_MS, 48), CURRENT)?.stale).toBe(true);
  expect(toPointForecast(runRows(CURRENT - 3 * HOUR_MS, 48), CURRENT)?.stale).toBe(false);
}

export function bucketsBeforeTheCurrentHourAreDropped(): void {
  const forecast = toPointForecast(runRows(CURRENT - 2 * HOUR_MS, 48), CURRENT);
  expect(forecast?.buckets).toHaveLength(46);
  expect(forecast?.buckets[0]).toEqual({ t: iso(CURRENT), p10: 11, p50: 12, p90: 13 });
  expect(forecast?.buckets.at(-1)?.t).toBe(iso(CURRENT + 45 * HOUR_MS));
  // The first bucket is the run's, read from the first row, not the first kept bucket.
  expect(forecast?.stale).toBe(false);
  expect(forecast?.issuedAt).toBe(iso(CURRENT - 2 * HOUR_MS + 5 * 60_000));
}

export function noRowsIsNull(): void {
  expect(toPointForecast([], CURRENT)).toBeNull();
  // A run whose every bucket is past (R1 keeps it out in SQL; the pure step agrees).
  expect(toPointForecast(runRows(CURRENT - 10 * HOUR_MS, 5), CURRENT)).toBeNull();
}

export function thePointForecastHasExactlyTheContractsKeys(): void {
  const forecast = toPointForecast(runRows(CURRENT, 3), CURRENT);
  expect(Object.keys(forecast ?? {}).sort()).toEqual(Object.keys(pointForecastSchema.shape).sort());
  expect(pointForecastSchema.parse(forecast)).toEqual(forecast);
  expect(forecast).toMatchObject({ modelName: "amazon/chronos-2", modelVersion: "0".repeat(40), stale: false });
}

export function theListRowMapsEveryFieldAndResolvesTheZoneLocationFirst(): void {
  const dto = toForecastListRow(listRow(), CURRENT);
  expect(dto).toEqual({
    assetId: "11111111-1111-4111-8111-111111111111",
    assetCode: "WBLDC-CR1",
    assetName: "Cold room 1",
    assetRtuName: "WBLDC RTU 1",
    locationId: "22222222-2222-4222-8222-222222222222",
    assetLocationName: "Kolkata DC",
    timeZone: "Asia/Kolkata",
    pointKey: "temp_c",
    unit: "°C",
    issuedAt: iso(CURRENT + 5 * 60_000),
    modelName: "amazon/chronos-2",
    modelVersion: "0".repeat(40),
    stale: false,
    p50Min: -18.5,
    p50Max: -17.25,
    p50PeakAt: iso(CURRENT + 4 * HOUR_MS),
  });
  expect(Object.keys(dto).sort()).toEqual(Object.keys(forecastListRowSchema.shape).sort());
  expect(forecastListRowSchema.parse(dto)).toEqual(dto);

  expect(toForecastListRow(listRow({ location_time_zone: null }), CURRENT).timeZone).toBe("Africa/Johannesburg");
  expect(toForecastListRow(listRow({ location_time_zone: null, organization_time_zone: null }), CURRENT).timeZone).toBe("UTC");
  expect(toForecastListRow(listRow({ unit: null }), CURRENT).unit).toBeNull();
  expect(toForecastListRow(listRow({ asset_rtu_name: null }), CURRENT).assetRtuName).toBeNull();
  expect(toForecastListRow(listRow({ first_bucket_ms: CURRENT - 4 * HOUR_MS }), CURRENT).stale).toBe(true);
  expect(toForecastListRow(listRow({ first_bucket_ms: CURRENT - 3 * HOUR_MS }), CURRENT).stale).toBe(false);
}
