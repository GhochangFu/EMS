/**
 * `F4.302` / ADR 0108 Amendment 4 — the Control Room Trends & Energy tab's segment view:
 * `GET /control-room/sites/:locationId/segment-views?segment=&point=&range=&from=&to=&compare=`.
 *
 * A segment is an `asset_domains.code` row and a point a `point_keys.code` row, so both are plain
 * strings: the vocabulary is data, never a union, and no label falls back to a literal.
 *
 * Plain `z.object` throughout. No `.merge()` / `.extend()` / `.omit()` (the ADR 0030 flattening
 * trap); no `z.intersection`, because no type here is `A & B`; no `.readonly()`. The query takes
 * `energyViewRangeSchema` by reference, and the bucket shape is `pointAggregateBucketSchema` by
 * reference.
 */
import { z } from "zod";

import { CATALOG_CODE_PATTERN } from "../constants";
import { aggregateLevelSchema } from "./aggregate-level";
import { energyViewRangeSchema } from "./energy-view";
import { pointAggregateBucketSchema } from "./envelopes";
import { trendPointSourceSchema } from "./trend-points";

/** Assets drawn in the chart; the rest of the ranking has `buckets: null` (item 4). */
export const SEGMENT_VIEW_SERIES_MAX = 8;
/** Assets in the ranking; the rest is `moreAssets` (item 4). */
export const SEGMENT_RANKING_MAX = 50;
/** `current / baseline` at or below this is `below` (owner, 2026-11-02: -50 %). */
export const ABNORMAL_BELOW_RATIO = 0.5;
/** A baseline within this fraction of the scale is `not_comparable` (drafter choice, relative). */
export const ABNORMAL_NEAR_ZERO_FRACTION = 0.01;
/**
 * The `?view=` value of the Energy sub-tab (item 8). A segment sub-tab is `?view=<domain code>`,
 * so `energy` is reserved: no `bms.asset_domains` row may carry it (owner ruling B, 2026-11-02;
 * gated by `tests/f4.302-energy-domain-code-reserved.integration.test.ts`).
 */
export const SITE_TRENDS_ENERGY_VIEW = "energy";

/**
 * `.strict()` and no refinement, so the OpenAPI document expresses it whole. Cross-field faults
 * (`custom` needs both instants, `from < to`, the window cap) are the service's 400s, the
 * `energyViewQuerySchema` precedent.
 */
export const siteSegmentViewsQuerySchema = z
  .object({
    segment: z.string().regex(CATALOG_CODE_PATTERN).optional(),
    point: z.string().regex(CATALOG_CODE_PATTERN).optional(),
    range: energyViewRangeSchema,
    from: z.string().datetime({ offset: true }).optional().describe("ISO instant; required when range is custom."),
    to: z.string().datetime({ offset: true }).optional().describe("ISO instant; required when range is custom."),
    compare: z.literal("previous").optional().describe("Add the previous period of equal length."),
  })
  .strict();

export const segmentViewPeriodSchema = z.object({
  from: z.string(),
  to: z.string(),
  durationHours: z.number(),
});

export const segmentViewSegmentRefSchema = z.object({
  domain: z.string(),
  label: z.string(),
  assetCount: z.number().int().min(0),
});

export const segmentViewSegmentSchema = z.object({
  domain: z.string(),
  label: z.string(),
  source: trendPointSourceSchema,
});

export const segmentViewPointSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** The catalog unit, `point_keys.unit`. */
  unit: z.string().nullable(),
});

/** One asset's figures over one period. */
export const segmentViewStatsSchema = z.object({
  /** The weighted mean (ADR 0023), not the mean of bucket means. */
  mean: z.number(),
  max: z.number(),
  maxAt: z.string().nullable(),
  sampleCount: z.number().int().min(0),
});

export const segmentViewRankingEntrySchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  /** The registration's effective unit, `COALESCE(asset_points.unit, point_keys.unit)`. */
  unit: z.string().nullable(),
  current: segmentViewStatsSchema,
  compare: segmentViewStatsSchema.nullable(),
  /** `null` past `SEGMENT_VIEW_SERIES_MAX` assets. */
  buckets: z.array(pointAggregateBucketSchema).nullable(),
  compareBuckets: z.array(pointAggregateBucketSchema).nullable(),
});

export const segmentAbnormalVerdictSchema = z.enum(["above", "below", "not_comparable", "not_enough_history"]);

export const segmentAbnormalEntrySchema = z.object({
  assetId: z.string().uuid(),
  assetCode: z.string(),
  assetName: z.string(),
  unit: z.string().nullable(),
  currentMean: z.number(),
  baselineMean: z.number().nullable(),
  ratio: z.number().nullable(),
  verdict: segmentAbnormalVerdictSchema,
  /** Counting windows behind the baseline. */
  baselineWindows: z.number().int().min(0),
});

export const segmentAbnormalBaselineSchema = z.object({
  windows: z.number().int().min(0),
  windowsConsulted: z.number().int().min(0),
  stepDays: z.number().int().min(1),
  ratio: z.number(),
  belowRatio: z.number(),
  nearZeroFraction: z.number(),
});

export const segmentAbnormalSchema = z.object({
  baseline: segmentAbnormalBaselineSchema,
  entries: z.array(segmentAbnormalEntrySchema),
  /** Assets compared and within the band: counted, never sent. */
  normalCount: z.number().int().min(0),
  truncated: z.boolean(),
});

export const siteSegmentViewsSchema = z.object({
  locationId: z.string().uuid(),
  timeZone: z.string(),
  generatedAt: z.string(),
  level: aggregateLevelSchema,
  bucket: aggregateLevelSchema,
  current: segmentViewPeriodSchema,
  compare: segmentViewPeriodSchema.nullable(),
  /** Every segment present at the site, so the sub-tab nav comes from the one read. */
  segments: z.array(segmentViewSegmentRefSchema),
  segment: segmentViewSegmentSchema.nullable(),
  points: z.array(segmentViewPointSchema),
  point: segmentViewPointSchema.nullable(),
  ranking: z.array(segmentViewRankingEntrySchema),
  moreAssets: z.number().int().min(0),
  seriesCount: z.number().int().min(0),
  trimmed: z.boolean(),
  abnormal: segmentAbnormalSchema,
});
