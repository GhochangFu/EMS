import { z } from "zod";

/**
 * `F3.68` / ADR 0076 decision 7 — `GET /api/v1/control-room/sites/:locationId/generated`.
 *
 * The server orders every asset's points `headlineRank ASC NULLS LAST,
 * pointKey ASC` (D1); the card shows only the first `HEADLINE_POINT_COUNT` of
 * them, "All points" expands the rest inline (D6, OQ2). Plain `z.object`
 * throughout — no `.merge()`, no `z.intersection`, no `.readonly()`: nothing
 * here is read-only-by-contract and there is no shared base to compose from
 * (ADR 0030 decision 2).
 */

/** How many of an asset's server-ordered points the card shows before "All
 * points" expands the rest (D6). */
export const HEADLINE_POINT_COUNT = 4;

/** One registered point of one asset, with its latest sample (D2, D4-2). */
export const generatedSitePointSchema = z.object({
  pointKey: z.string(),
  name: z.string().nullable(),
  unit: z.string().nullable(),
  headlineRank: z.number().int().nullable(),
  latest: z
    .object({
      value: z.number(),
      time: z.string(),
    })
    .nullable(),
});

/** One asset of a site, its live status and its registered points, server-
 * ordered (D1, D3). */
export const generatedSiteAssetSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  domain: z.string(),
  latestTelemetryAt: z.string().nullable(),
  freshness: z.enum(["live", "stale", "none"]),
  points: z.array(generatedSitePointSchema),
});

/** One asset-domain panel of a site (D4-1). */
export const generatedSiteDomainSchema = z.object({
  code: z.string(),
  label: z.string(),
  assets: z.array(generatedSiteAssetSchema),
});

/** `GET /api/v1/control-room/sites/:locationId/generated` — one panel per
 * asset domain present at the site (D4). */
export const generatedSiteViewDtoSchema = z.object({
  locationId: z.string().uuid(),
  asOf: z.string(),
  domains: z.array(generatedSiteDomainSchema),
});
