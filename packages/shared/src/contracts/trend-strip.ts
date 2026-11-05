/**
 * `F4.301` / ADR 0108 Amendment 2 — the Control Room trend strip:
 * `GET /control-room/sites/:locationId/trend-strip?range=&assetGroupId=`.
 *
 * A segment is an `asset_domains.code` row, so `domain` is a plain string: the
 * vocabulary is data, never a union, and no label falls back to a literal.
 *
 * Plain `z.object` throughout. No `.merge()` / `.extend()` / `.omit()` (the
 * ADR 0030 flattening trap); no `z.intersection`, because no type here is
 * `A & B`; no `.readonly()`, because nothing is read-only by contract. The
 * bucket shape is `pointAggregateBucketSchema` by reference — its optional
 * stats fields stay absent on this route (one statistic, the weighted mean,
 * ruling 4.5).
 */
import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";

import { aggregateLevelSchema } from "./aggregate-level";
import { pointAggregateBucketSchema } from "./envelopes";
import { trendPointSourceSchema } from "./trend-points";
import {
  TREND_STRIP_POINT_CODE_MAX,
  TREND_STRIP_SEGMENT_CODE_MAX,
  TREND_STRIP_WIDGET_MAX_POINTS,
} from "./trend-strip-widget";

/**
 * The strip's own read level per range (Amendment 2 item 5). The widget ladder
 * is not used: it has no `5m` rung and would read `_1m` for 24 h. Every
 * `bucketSeconds` divides the window exactly (≤ 60 buckets) and divides
 * 86 400 s, so the JS epoch floor and `time_bucket`'s 2000-01-03 origin agree.
 */
export const TREND_STRIP_RANGES = {
  "24h": { windowMinutes: 1440, bucketSeconds: 1800, level: "5m" },
  "7d": { windowMinutes: 10080, bucketSeconds: 10800, level: "1h" },
  "30d": { windowMinutes: 43200, bucketSeconds: 43200, level: "1h" },
} as const;

export const trendStripRangeSchema = z.enum(["24h", "7d", "30d"]);

/** Sparklines per trend-point row, by asset code; the rest is `moreAssets` (owner, plan Q1). */
export const TREND_STRIP_MAX_ASSETS_PER_POINT = 6;

/** Trend points per segment on a whole-site strip; a group tab shows its full list (owner, plan Q2). */
export const TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT = 3;

/** Server bound on the series in one response, met by a deterministic trim — never a 500. */
export const TREND_STRIP_MAX_SERIES = 180;

/** `CATALOG_CODE_PATTERN` without its anchors, so the selection patterns restate nothing. */
const CODE = CATALOG_CODE_PATTERN.source.slice(1, -1);

/**
 * `F4.306` / ADR 0108 Amendment 7 — the longest `segments` query value: 30 of the longest
 * segment codes, each with its separator. Built from the widget config's per-entry limits, so
 * every stored selection is a query this route accepts.
 */
export const TREND_STRIP_QUERY_SEGMENTS_MAX = TREND_STRIP_WIDGET_MAX_POINTS * (TREND_STRIP_SEGMENT_CODE_MAX + 1);

/** The longest `points` query value: 30 of the longest `<segment>:<point code>` entries, each with its separator. */
export const TREND_STRIP_QUERY_POINTS_MAX =
  TREND_STRIP_WIDGET_MAX_POINTS * (TREND_STRIP_SEGMENT_CODE_MAX + 1 + TREND_STRIP_POINT_CODE_MAX + 1);

/** `code(,code)*` — the segment codes, comma-separated. */
const segmentsQueryPattern = new RegExp(`^${CODE}(,${CODE})*$`);

/** `code:code(,code:code)*` — the `<segment>:<point code>` entries, comma-separated. */
const pointsQueryPattern = new RegExp(`^${CODE}:${CODE}(,${CODE}:${CODE})*$`);

/**
 * `.strict()` and no refinement, so the OpenAPI document expresses it whole. `points` without
 * `segments` parses here; the service refuses it (a 400), and parses, dedupes and applies both.
 */
export const siteTrendStripQuerySchema = z
  .object({
    range: trendStripRangeSchema,
    assetGroupId: z.string().uuid().optional(),
    segments: z
      .string()
      .max(TREND_STRIP_QUERY_SEGMENTS_MAX)
      .regex(segmentsQueryPattern)
      .describe("Comma-separated segment (asset domain) codes the strip draws; absent means every segment.")
      .optional(),
    points: z
      .string()
      .max(TREND_STRIP_QUERY_POINTS_MAX)
      .regex(pointsQueryPattern)
      .describe(
        "Comma-separated `<segment>:<point code>` entries the strip draws; requires `segments`. " +
          "Absent means each chosen segment's default points.",
      )
      .optional(),
  })
  .strict();

export const trendStripAssetSeriesSchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  /** `F4.316` (ADR 0111) — the asset's RTU display name, `null` when it has none. */
  assetRtuName: z.string().nullable(),
  /** `F4.316` (ADR 0111) — the asset's location name; the label's `where` when there is no RTU. */
  assetLocationName: z.string().nullable(),
  assetName: z.string(),
  /** The registration's effective unit, `COALESCE(asset_points.unit, point_keys.unit)`. */
  unit: z.string().nullable(),
  buckets: z.array(pointAggregateBucketSchema),
});

export const trendStripPointSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** The catalog unit, `point_keys.unit`. */
  unit: z.string().nullable(),
  assets: z.array(trendStripAssetSeriesSchema),
  /** Assets that register this point beyond the per-point cap — a count, never ids. */
  moreAssets: z.number().int().min(0),
});

export const trendStripSegmentSchema = z.object({
  domain: z.string(),
  label: z.string(),
  source: trendPointSourceSchema,
  points: z.array(trendStripPointSchema),
});

export const siteTrendStripSchema = z.object({
  locationId: z.string().uuid(),
  assetGroupId: z.string().uuid().nullable(),
  range: trendStripRangeSchema,
  from: z.string().datetime(),
  to: z.string().datetime(),
  level: aggregateLevelSchema,
  bucketSeconds: z.number().int().positive(),
  timeZone: z.string(),
  assetsPerPoint: z.number().int().min(0),
  pointsPerSegment: z.number().int().min(0),
  trimmed: z.boolean(),
  segments: z.array(trendStripSegmentSchema),
});
