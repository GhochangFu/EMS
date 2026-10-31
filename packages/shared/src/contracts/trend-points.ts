/**
 * `F4.300` / ADR 0108 decision 3 — the catalog trend points and the
 * per-organization override. A segment is an `asset_domains.code` row, so
 * `domain` is a plain string here: the vocabulary is data, never a union.
 *
 * Plain `z.object` throughout. No intersection and no readonly is needed, so
 * the `.merge()` / `.extend()` flattening trap of ADR 0030 does not arise.
 */
import { z } from "zod";

import { CATALOG_CODE_MESSAGE, CATALOG_CODE_PATTERN } from "../constants";

/** Most codes one organization may list for one segment (plan C4). */
export const TREND_POINTS_PER_SEGMENT_MAX = 12;

/** Where a segment's effective list came from. */
export const trendPointSourceSchema = z.enum(["catalog", "organization"]);

export const trendPointSchema = z.object({
  code: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  active: z.boolean(),
});

export const trendPointSegmentSchema = z.object({
  domain: z.string(),
  label: z.string(),
  source: trendPointSourceSchema,
  points: z.array(trendPointSchema),
  catalogDefaults: z.array(trendPointSchema),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().uuid().nullable(),
});

export const orgTrendPointsDtoSchema = z.object({
  organizationId: z.string().uuid(),
  segments: z.array(trendPointSegmentSchema),
});

export const siteTrendPointsDtoSchema = z.object({
  locationId: z.string().uuid(),
  organizationId: z.string().uuid(),
  segments: z.array(trendPointSegmentSchema),
});

/** `PUT` body: replace-all for one (organization, segment); `[]` = catalog default. */
export const putOrgTrendPointsBodySchema = z
  .object({
    pointKeys: z
      .array(z.string().min(1).max(128).regex(CATALOG_CODE_PATTERN, CATALOG_CODE_MESSAGE))
      .max(TREND_POINTS_PER_SEGMENT_MAX),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (new Set(body.pointKeys).size !== body.pointKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pointKeys"],
        message: "pointKeys must not repeat a code",
      });
    }
  });
