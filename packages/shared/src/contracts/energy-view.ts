import { z } from "zod";

import { aggregateLevelSchema } from "./aggregate-level";
import { energyReportSourceTotalsSchema, energySourceMixPointSchema, energyTopConsumerSchema } from "./operations";
import { foldRepeatedQueryValue } from "./query-values";
import { reportSiteFilterSchema } from "./report-writes";

/**
 * `F4.298` (ADR 0108 decision 2) — the Energy page's filter and KPI view.
 *
 * `GET /reports/energy/view` is a sibling of the energy preview, not a widened
 * preview (owner ruling a): `energyReportQuerySchema` is parsed by four routes
 * and feeds the CSV/XLSX/PDF exports, whose bytes are a client deliverable.
 * Nothing here is `A & B`, so there is no `z.intersection`; plain `z.object`s,
 * and no `.merge()` / `.extend()` (`tests/adr-0030-contract-derivation.test.ts`).
 */

/** The seven ranges. Presets end at the server's `now`; `custom` takes `from`/`to`. */
export const energyViewRangeSchema = z.enum(["today", "24h", "7d", "30d", "this_month", "1y", "custom"]);

/**
 * The view's query, `.strict()` (registered in `QUERY_SCHEMAS`, no ledger
 * entry — the `mappingSheetQuerySchema` precedent). Cross-field rules (`custom`
 * needs both instants, `from < to`, at most `MAX_WIDGET_WINDOW_MINUTES`) are a
 * 400 from the service, the `energyReportRange` precedent, not a `superRefine`.
 */
export const energyViewQuerySchema = z
  .object({
    range: energyViewRangeSchema,
    from: z.string().datetime({ offset: true }).optional().describe("ISO instant; required when range is custom."),
    to: z.string().datetime({ offset: true }).optional().describe("ISO instant; required when range is custom."),
    organizationId: z.string().uuid().optional(),
    locationIds: z.preprocess(foldRepeatedQueryValue, reportSiteFilterSchema.optional()),
    compare: z.literal("previous").optional().describe("Add the previous period of equal length."),
  })
  .strict();

/** One period of the view: the current one, or the compare one. */
export const energyViewPeriodSchema = z.object({
  from: z.string(),
  to: z.string(),
  durationHours: z.number(),
  /** At least one `kw` bucket in the period. The web computes a change only when both periods have data. */
  hasData: z.boolean(),
  totalKwh: z.number(),
  /** `MAX` over read-level buckets of the summed kW. */
  peakKw: z.number(),
  peakAt: z.string().nullable(),
  /** The sample average of every `pf` point in scope; `null` when there is no `pf` row. */
  avgPf: z.number().nullable(),
  pueEstimate: z.number().nullable(),
  indicativeCost: z.number().nullable(),
  tariffPerKwh: z.number().nullable(),
  currency: z.string().nullable(),
  sourceTotals: energyReportSourceTotalsSchema,
  series: z.array(energySourceMixPointSchema),
});

/**
 * Two counts and nothing else (`.strict()`): no id, name or code of a location
 * the caller cannot read leaves the server (owner ruling, ADR 0108 decision 2.9).
 */
export const energyViewPartialSchema = z
  .object({
    readableSites: z.number().int().nonnegative(),
    selectedSites: z.number().int().nonnegative(),
  })
  .strict();

export const energyViewSchema = z.object({
  organizationId: z.string(),
  /** The stored zone the presets resolved in (`"UTC"` included; computed as `Etc/UTC`). */
  timeZone: z.string(),
  generatedAt: z.string(),
  /** The rollup relation read. */
  level: aggregateLevelSchema,
  /** The display bucket of `series`. */
  bucket: aggregateLevelSchema,
  current: energyViewPeriodSchema,
  /** `null` when `compare` was not asked. */
  compare: energyViewPeriodSchema.nullable(),
  /** The current period only. */
  topConsumers: z.array(energyTopConsumerSchema),
  /** `null` when the caller reads every location (`readableLocationIds === null`). */
  partial: energyViewPartialSchema.nullable(),
});

export const energyFilterOrganizationSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
});

/** A readable location; `parentId` is `null` when the parent is not readable. */
export const energyFilterLocationSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  organizationId: z.string(),
});

/** `GET /reports/energy/filter-options` — the caller's readable set, for every role. */
export const energyFilterOptionsSchema = z.object({
  organizations: z.array(energyFilterOrganizationSchema),
  locations: z.array(energyFilterLocationSchema),
});
