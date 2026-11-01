import { z } from "zod";

import { aggregateLevelSchema } from "./aggregate-level";
import { energyViewPartialSchema } from "./energy-view";

/**
 * `F4.299` (ADR 0108 Amendment 1, 7.3) — the four organization views of the
 * Energy page: sites ranked, the stacked total trend, the day x hour heatmap
 * and the abnormal list. `GET /reports/energy/organization-views` parses
 * `energyViewQuerySchema` by identity; only the response is new.
 *
 * Plain `z.object`s and one `z.discriminatedUnion`; no `.merge()`, `.extend()`,
 * `z.intersection` or `.readonly()` (`tests/adr-0030-contract-derivation.test.ts`).
 */

/** The server sends at most this many site columns; the rest fold into `other`. */
export const TREND_SITE_SERIES_MAX = 8;
/** The server sends the top sites by kWh, at most this many. */
export const SITE_RANKING_MAX = 50;
/** The abnormal list is cut to this many entries; `truncated` says so. */
export const ABNORMAL_LIST_MAX = 100;
/** Copies of the period shifted back by whole local days. */
export const BASELINE_WINDOWS = 4;
/** Fewer counting windows than this is "not enough history". */
export const MIN_BASELINE_WINDOWS = 3;
/** `current / baseline` at or above this is `above`. */
export const ABNORMAL_RATIO = 1.5;

export const energySiteEnergySchema = z.object({
  locationId: z.string().uuid(),
  /** `bms.locations.name`, never `assets.site_name`. */
  name: z.string(),
  assetCount: z.number().int().nonnegative(),
  kwh: z.number(),
  peakKw: z.number(),
  peakAt: z.string().nullable(),
});

export const energySiteRankingSchema = z.object({
  current: z.array(energySiteEnergySchema),
  /** The previous period for the same sites; `null` when `compare` was not asked. */
  compare: z.array(energySiteEnergySchema).nullable(),
  /** Sites with data in the current period, before the `SITE_RANKING_MAX` cut. */
  totalSites: z.number().int().nonnegative(),
});

export const energySiteTrendColumnSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site"), locationId: z.string().uuid(), name: z.string() }),
  z.object({ kind: z.literal("other") }),
]);

export const energySiteTrendSchema = z.object({
  columns: z.array(energySiteTrendColumnSchema),
  /** One aligned grid: `kw[i]` belongs to `columns[i]`; zeros, never holes. */
  points: z.array(z.object({ t: z.string(), kw: z.array(z.number()) })),
});

export const energyHeatmapCellSchema = z.object({
  /** The local date `YYYY-MM-DD` in the view's zone. */
  day: z.string(),
  hour: z.number().int().min(0).max(23),
  kwh: z.number(),
});

export const energyAbnormalEntrySchema = z.object({
  kind: z.enum(["site", "asset"]),
  id: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  siteName: z.string().nullable(),
  currentKwh: z.number(),
  baselineKwh: z.number().nullable(),
  ratio: z.number().nullable(),
  /** `normal` is counted in `normalCount`, never sent. */
  verdict: z.enum(["above", "not_enough_history"]),
  baselineWindows: z.number().int().nonnegative(),
});

const energyOrganizationViewsBoundsSchema = z.object({
  from: z.string(),
  to: z.string(),
  durationHours: z.number(),
});

export const energyOrganizationViewsSchema = z.object({
  organizationId: z.string(),
  timeZone: z.string(),
  generatedAt: z.string(),
  level: aggregateLevelSchema,
  bucket: aggregateLevelSchema,
  current: energyOrganizationViewsBoundsSchema,
  compare: energyOrganizationViewsBoundsSchema.nullable(),
  sites: energySiteRankingSchema,
  trend: energySiteTrendSchema,
  heatmap: z.object({ cells: z.array(energyHeatmapCellSchema) }),
  abnormal: z.object({
    baseline: z.object({
      windows: z.number().int().nonnegative(),
      windowsConsulted: z.number().int().nonnegative(),
      stepDays: z.number().int().nonnegative(),
      ratio: z.number(),
    }),
    entries: z.array(energyAbnormalEntrySchema),
    normalCount: z.object({
      sites: z.number().int().nonnegative(),
      assets: z.number().int().nonnegative(),
    }),
    truncated: z.boolean(),
  }),
  partial: energyViewPartialSchema.nullable(),
});
