import { z } from "zod";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c, S3, C3, C4, C7 — the forecast read
 * contracts: `GET /ml/points/:pointRef/forecast` and `GET /ml/forecasts`.
 *
 * Every schema is one plain `z.object` (ADR 0030): no intersection and no
 * all-readonly object, so neither `z.intersection` nor `.readonly()` applies.
 * None is `.strict()`: these are responses, and an API newer than its web adds
 * a key the older bundle must still parse. The types are `z.infer`, exported
 * from this file (plan R17, the `maintenance-windows.ts` precedent), because
 * `src/index.ts` sits at the §4.5 cap.
 *
 * **Only three run fields reach the wire (S3):** the model name, the model
 * version and the issue time. `error_text`, `config_hash` and `rows_written`
 * have no field here, so no producer can carry them.
 *
 * Times are ISO UTC. A screen formats them in the site zone, as the history page
 * does; the list carries each row's zone (C7).
 */

/** A forecast whose first bucket (the hour its run scored) is more than this many hours before now is stale (C3). */
export const FORECAST_STALE_AFTER_HOURS = 3;

/**
 * The scorer's largest horizon (`ML_FORECAST_HORIZON_HOURS`, 1–64, in
 * `apps/ml/src/bms_ml/config.py`). No run older than this has a bucket at or after
 * the current hour, so it bounds both reads' look-back (plan R3).
 * `tests/e1.1-ml-readiness-single-source.test.ts` holds the two equal.
 */
export const FORECAST_MAX_HORIZON_HOURS = 64;

const isoDateTime = z.string().datetime();
const quantile = z.number().finite();

/** One hour of a forecast: the bucket's start (a whole UTC hour) and its three quantiles. */
export const forecastBucketSchema = z.object({
  t: isoDateTime,
  p10: quantile,
  p50: quantile,
  p90: quantile,
});

/** The current forecast for one point: the newest succeeded run that holds the current hour (R1). */
export const pointForecastSchema = z.object({
  /** The run's start. */
  issuedAt: isoDateTime,
  /** The Hub repository, e.g. `amazon/chronos-2`. */
  modelName: z.string().max(128),
  /** The Hub revision. */
  modelVersion: z.string().max(128),
  /** The run's first bucket is more than `FORECAST_STALE_AFTER_HOURS` before the current hour. */
  stale: z.boolean(),
  /** Buckets at or after the current hour, ascending (C4). */
  buckets: z.array(forecastBucketSchema),
});

/**
 * `GET /ml/points/:pointRef/forecast`. `asOf` is the server's instant, so no
 * screen trusts the browser clock for the "now" marker or the live-range rule
 * (R5). `forecast` is `null` when the point has no current forecast (R-c: 200,
 * never 404).
 */
export const pointForecastResponseSchema = z.object({
  asOf: isoDateTime,
  forecast: pointForecastSchema.nullable(),
});

/** One forecast point the caller can read, for the Forecasts list page. */
export const forecastListRowSchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  locationId: z.string().uuid(),
  locationName: z.string(),
  /** The site's IANA zone: the location's, else the organization's, else `UTC` (C7). */
  timeZone: z.string(),
  pointKey: z.string().max(128),
  unit: z.string().max(32).nullable(),
  issuedAt: isoDateTime,
  modelName: z.string().max(128),
  modelVersion: z.string().max(128),
  stale: z.boolean(),
  /** The smallest p50 over the buckets at or after the current hour. */
  p50Min: quantile,
  /** The largest p50 over the same buckets. */
  p50Max: quantile,
  /** The bucket of `p50Max`; the earliest such bucket on a tie. */
  p50PeakAt: isoDateTime,
});

/** `GET /ml/forecasts`. */
export const forecastListResponseSchema = z.object({
  items: z.array(forecastListRowSchema),
});

export type ForecastBucket = z.infer<typeof forecastBucketSchema>;
export type PointForecast = z.infer<typeof pointForecastSchema>;
export type PointForecastResponse = z.infer<typeof pointForecastResponseSchema>;
export type ForecastListRow = z.infer<typeof forecastListRowSchema>;
export type ForecastListResponse = z.infer<typeof forecastListResponseSchema>;
