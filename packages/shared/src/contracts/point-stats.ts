import { z } from "zod";

/**
 * `F4.291` PR 3 (ADR 0099 Amendment 9 E5(c)) — the copilot's `get_point_stats`
 * answer: one point key over up to 25 assets for `[from, to)`, min / average /
 * max / sample count per asset from the rollup level the window's length
 * picks (`bucketSeconds`), and `last` / `lastAt`: the mean of the newest
 * 1-minute bucket in the window that holds a sample, and that bucket's start
 * (owner ruling P6).
 *
 * The service answers only the assets with a sample in the window; the tool
 * fills every other requested asset with null stats and `sampleCount: 0`, so
 * the model is told "no data" in a row, never by a missing one. Each stat is
 * `null`, never absent, for the same reason.
 *
 * **Encoding (§4.8):** plain `z.object` throughout — no `.merge()`, no
 * `.extend()` of another contract, no intersection. Not `.readonly()`: the
 * sibling telemetry contract (`pointAggregateResponseSchema`) is mutable and
 * the service builds this one from mutable literals. Not `.strict()`: an
 * extra key a later service adds is stripped by the tool's parse, never sent
 * to the model.
 */

/** The most assets one answer covers: the copilot tool's per-page bound. */
export const POINT_STATS_MAX_ASSETS = 25;

export const pointStatsRowSchema = z.object({
  assetId: z.string().uuid(),
  min: z.number().nullable(),
  avg: z.number().nullable(),
  max: z.number().nullable(),
  last: z.number().nullable(),
  lastAt: z.string().datetime({ offset: true }).nullable(),
  sampleCount: z.number().int().min(0),
});

export const pointStatsByAssetSchema = z.object({
  pointKey: z.string().min(1).max(128),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  bucketSeconds: z.number().int().positive(),
  rows: z.array(pointStatsRowSchema).max(POINT_STATS_MAX_ASSETS),
});
