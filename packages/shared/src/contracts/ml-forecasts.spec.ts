import { expect } from "vitest";

import {
  FORECAST_MAX_HORIZON_HOURS,
  FORECAST_STALE_AFTER_HOURS,
  forecastBucketSchema,
  forecastListResponseSchema,
  forecastListRowSchema,
  pointForecastResponseSchema,
} from "./ml-forecasts";

/**
 * `E1.4a` / ADR 0135 Amendment 3 — the forecast read contracts. Assertions live
 * here; `ml-forecasts.test.ts` is the vitest entry point (ADR 0014). Plan
 * `docs/plans/e1.4-forecast-read-path.md` §5, T1.6.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const HOUR = "2026-11-16T10:00:00.000Z";

const bucket = { t: HOUR, p10: -20, p50: -18, p90: -16 };

const forecast = {
  issuedAt: "2026-11-16T10:05:00.000Z",
  modelName: "amazon/chronos-2",
  modelVersion: "0".repeat(40),
  stale: false,
  buckets: [bucket],
};

const row = {
  assetId: ASSET,
  assetCode: "WBLDC-CR1",
  assetName: "Cold room 1",
  locationId: LOCATION,
  locationName: "Kolkata DC",
  timeZone: "Asia/Kolkata",
  pointKey: "temp_c",
  unit: "°C",
  issuedAt: "2026-11-16T10:05:00.000Z",
  modelName: "amazon/chronos-2",
  modelVersion: "0".repeat(40),
  stale: false,
  p50Min: -18.5,
  p50Max: -17.2,
  p50PeakAt: "2026-11-16T14:00:00.000Z",
};

export function runConstantsTest(): void {
  expect(FORECAST_STALE_AFTER_HOURS).toBe(3);
  expect(FORECAST_MAX_HORIZON_HOURS).toBe(64);
}

export function runNullForecastTest(): void {
  expect(pointForecastResponseSchema.parse({ asOf: HOUR, forecast: null })).toEqual({ asOf: HOUR, forecast: null });
  expect(pointForecastResponseSchema.parse({ asOf: HOUR, forecast }).forecast?.buckets).toEqual([bucket]);
  expect(pointForecastResponseSchema.safeParse({ asOf: HOUR }).success, "forecast is required, null when absent").toBe(false);
}

export function runBucketTest(): void {
  const { p10: _dropped, ...withoutP10 } = bucket;
  expect(forecastBucketSchema.safeParse(withoutP10).success).toBe(false);
  expect(forecastBucketSchema.safeParse({ ...bucket, p50: Number.NaN }).success).toBe(false);
  expect(forecastBucketSchema.safeParse({ ...bucket, t: "not a time" }).success).toBe(false);
  expect(
    pointForecastResponseSchema.safeParse({ asOf: HOUR, forecast: { ...forecast, buckets: [withoutP10] } }).success,
    "a bucket without p10 is refused inside the response too",
  ).toBe(false);
}

export function runNotStrictTest(): void {
  // Responses are never `.strict()`: a newer API may add a key an older web must still read.
  expect(pointForecastResponseSchema.safeParse({ asOf: HOUR, forecast: { ...forecast, extra: 1 }, extra: 2 }).success).toBe(true);
  expect(forecastListRowSchema.safeParse({ ...row, extra: true }).success).toBe(true);
}

export function runListRowTest(): void {
  expect(forecastListResponseSchema.parse({ items: [row] }).items).toEqual([row]);
  expect(forecastListRowSchema.safeParse({ ...row, unit: null }).success).toBe(true);
  expect(forecastListRowSchema.safeParse({ ...row, pointKey: "k".repeat(128) }).success).toBe(true);
  expect(forecastListRowSchema.safeParse({ ...row, pointKey: "k".repeat(129) }).success).toBe(false);
  expect(forecastListRowSchema.safeParse({ ...row, unit: "u".repeat(33) }).success).toBe(false);
  expect(forecastListRowSchema.safeParse({ ...row, modelName: "m".repeat(129) }).success).toBe(false);
  expect(forecastListRowSchema.safeParse({ ...row, assetId: "not-a-uuid" }).success).toBe(false);
}

/** S3: no run field beyond name, version and issue time has a home in either contract. */
export function runRunFieldsTest(): void {
  const keys = Object.keys(forecastListRowSchema.shape);
  for (const forbidden of ["errorText", "configHash", "rowsWritten", "error_text", "config_hash", "rows_written"]) {
    expect(keys).not.toContain(forbidden);
  }
  const parsed = forecastListRowSchema.parse({ ...row, errorText: "boom", configHash: "a".repeat(64), rowsWritten: 48 });
  expect(Object.keys(parsed)).toEqual(Object.keys(row));
}
